import { performance } from "node:perf_hooks";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import {
  platformRedemptionCodeArn,
  platformRedemptionCodeCollectionArn,
  isRedemptionCodeResourceId,
} from "@/iam/resources/platform-redemption-code-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  PlatformRedemptionCodeWriteRepository,
  normalizeRedemptionCodeCreate,
} from "@/store/billing/platform-redemption-code-write.repository";
import type {
  PlatformRedemptionCodeWriteStore,
  RedemptionCodeWriteGuard,
} from "@/store/billing/platform-redemption-code-write.store";
import { validRedemptionCodeTarget } from "@/store/billing/platform-redemption-code-read.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
import type { CreateRedemptionCodeDto } from "@/api/dto/billing/redemption-code.dto";
export class PlatformRedemptionCodeWriteIamService {
  private static instance: PlatformRedemptionCodeWriteIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformRedemptionCodeWriteStore = PlatformRedemptionCodeWriteRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformRedemptionCodeWriteIamService());
  }
  private principal(userId: string, request?: TypedRequest) {
    const identity = request && getIamPrincipal(request);
    if (
      !request ||
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      identity.subjectUserId !== userId
    )
      throw iamAccountDenied();
    return { principal: { ...identity }, request };
  }
  private async evaluate(principal: IamPrincipal, request: TypedRequest, action: string, resources: readonly string[]) {
    if (
      !resources.length ||
      resources.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(resources).size !== resources.length
    )
      throw iamAccountDenied();
    const start = performance.now(),
      results = await this.iam.authorizeMany({
        principal,
        action,
        resources: [...resources],
        context: requestConditionContext(request, principal),
      });
    if (
      !Array.isArray(results) ||
      results.length !== resources.length ||
      results.some((result) => !result || !["Allow", "ExplicitDeny", "ImplicitDeny"].includes(result.decision))
    )
      throw iamAccountDenied();
    const records = (request.iamDecisions ??= []);
    records.splice(0, Math.max(0, records.length + results.length - IAM_AUTHORIZATION_LIMITS.resourcesPerRequest));
    results.forEach((result, index) => {
      records.push({ ...result, action, resource: resources[index]! });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[index]!,
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
      });
    });
    if (results.some((result) => result.decision !== "Allow")) throw iamAccountDenied();
  }
  private async guard(
    userId: string,
    request: TypedRequest | undefined,
    permission: Permission,
    action: string,
    resource: string,
  ) {
    const identity = this.principal(userId, request),
      { principal } = identity;
    const authorizationRevision = await this.repository.authorizationRevision(principal),
      snapshot = await this.identities.snapshot(principal, permission),
      hash = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
    await this.evaluate(principal, identity.request, action, [resource]);
    const recheck = async () => {
      await this.identities.recheck(principal, permission, snapshot);
      if (
        fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== hash ||
        (await this.repository.authorizationRevision(principal)) !== authorizationRevision
      )
        throw iamAccountDenied();
      await this.evaluate(principal, identity.request, action, [resource]);
      await this.identities.recheck(principal, permission, snapshot);
    };
    const guard: RedemptionCodeWriteGuard = {
      permission,
      group: snapshot.group,
      authorizationRevision,
      users: { principal, targetUserId: userId, users: snapshot.users, recheck },
      recheckEntries: async (ids) => {
        if (ids.some((id) => !isRedemptionCodeResourceId(id))) throw iamAccountDenied();
        await this.evaluate(principal, identity.request, action, ids.map(platformRedemptionCodeArn));
      },
    };
    return guard;
  }
  async create(input: CreateRedemptionCodeDto, userId: string, request?: TypedRequest, persist = true) {
    const data = normalizeRedemptionCodeCreate(input),
      guard = await this.guard(
        userId,
        request,
        Permission.REDEMPTION_CODE_CREATE,
        "quyan:redemption_code:CreateCodes",
        platformRedemptionCodeCollectionArn(),
      );
    if (!persist) {
      await guard.users.recheck();
      return undefined;
    }
    return this.repository.create(data, guard);
  }
  /** Compare the actual legacy-issued identities in shadow mode without a second write. */
  async simulateIssued(ids: readonly string[], userId: string, request?: TypedRequest) {
    normalizeRedemptionCodeCreate({ amount: 1, count: ids.length });
    if (new Set(ids).size !== ids.length || ids.some((id) => !isRedemptionCodeResourceId(id))) throw iamAccountDenied();
    const guard = await this.guard(
      userId,
      request,
      Permission.REDEMPTION_CODE_CREATE,
      "quyan:redemption_code:CreateCodes",
      platformRedemptionCodeCollectionArn(),
    );
    await guard.users.recheck();
    for (let index = 0; index < ids.length; index += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
      await guard.recheckEntries(ids.slice(index, index + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest));
    await guard.users.recheck();
  }
  async remove(id: string, userId: string, request?: TypedRequest, persist = true) {
    const { principal } = this.principal(userId, request);
    if (!isRedemptionCodeResourceId(id)) throw iamAccountDenied();
    const target = await this.repository.target(principal, id);
    if (!target || target.id !== id || !validRedemptionCodeTarget(target)) throw iamAccountDenied();
    const guard = await this.guard(
      userId,
      request,
      Permission.REDEMPTION_CODE_DELETE,
      "quyan:redemption_code:DeleteCode",
      platformRedemptionCodeArn(id),
    );
    if (!persist) {
      await guard.users.recheck();
      return undefined;
    }
    return this.repository.remove(
      { ...target, createTime: new Date(target.createTime), updateTime: new Date(target.updateTime) },
      guard,
    );
  }
}
