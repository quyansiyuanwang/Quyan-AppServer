import { performance } from "node:perf_hooks";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformDeveloperQuotaArn,
  platformDeveloperQuotaSubjectArn,
} from "@/iam/resources/platform-developer-quota-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformDeveloperQuotaWriteRepository } from "@/store/developer/platform-developer-quota-write.repository";
import type {
  PlatformDeveloperQuotaWriteStore,
  PlatformDeveloperQuotaWriteGuard,
} from "@/store/developer/platform-developer-quota-write.store";
import { upsertQuotaOverrideBodySchema } from "@/api/schema/developer/developer.schema";
import type { UpsertDeveloperQuotaOverrideDto } from "@/api/dto/developer/developer.dto";
import { isDeveloperQuotaRecordId } from "@/iam/resources/platform-developer-quota-resources";
import { BadRequestError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
export class PlatformDeveloperQuotaWriteIamService {
  private static instance: PlatformDeveloperQuotaWriteIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformDeveloperQuotaWriteStore = PlatformDeveloperQuotaWriteRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperQuotaWriteIamService());
  }
  private principal(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      principal.subjectUserId !== userId
    )
      throw iamAccountDenied();
    return { principal: { ...principal }, request };
  }
  private async evaluate(principal: IamPrincipal, request: TypedRequest, action: string, resource: string) {
    const start = performance.now();
    const result = await this.iam.authorize({
      principal,
      action,
      resource,
      context: requestConditionContext(request, principal),
    });
    if (!result) throw iamAccountDenied();
    (request.iamDecisions ??= []).push({ ...result, action, resource });
    auditIamDecision({
      requestId: request.res?.locals.requestId,
      principal,
      action,
      resource,
      result,
      evaluationLatencyMs: performance.now() - start,
      authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
      ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
    });
    if (result.decision !== "Allow") throw iamAccountDenied();
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
    const snapshot = await this.identities.snapshot(principal, permission);
    await this.evaluate(principal, identity.request, action, resource);
    const recheck = async () => {
      await this.identities.recheck(principal, permission, snapshot);
      await this.evaluate(principal, identity.request, action, resource);
      await this.identities.recheck(principal, permission, snapshot);
    };
    const guard: PlatformDeveloperQuotaWriteGuard = {
      permission,
      group: snapshot.group,
      users: { principal, targetUserId: userId, users: snapshot.users, recheck },
      recheckEntry: async (id) => this.evaluate(principal, identity.request, action, platformDeveloperQuotaArn(id)),
    };
    return guard;
  }
  async upsert(input: UpsertDeveloperQuotaOverrideDto, userId: string, request?: TypedRequest, persist = true) {
    const parsed = upsertQuotaOverrideBodySchema.strict().safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid quota override", undefined, { messageKey: "errors.badRequest" });
    const { principal } = this.principal(userId, request);
    const preparation = await this.repository.prepare(principal, parsed.data);
    const { subject, target } = preparation;
    if (
      subject.subjectType !== parsed.data.subjectType ||
      subject.subjectId !== parsed.data.subjectId ||
      subject.service !== (parsed.data.service ?? "*")
    )
      throw iamAccountDenied();
    const guard = await this.guard(
      userId,
      request,
      Permission.DEVELOPER_QUOTA_MANAGE,
      "quyan:developer:UpsertQuotaOverride",
      platformDeveloperQuotaSubjectArn(subject.subjectType, subject.subjectId, subject.service),
    );
    if (target) await guard.recheckEntry(target.id);
    if (!persist) {
      await guard.users.recheck();
      return undefined;
    }
    return this.repository.upsert(parsed.data, preparation, guard);
  }
  async remove(id: string, userId: string, request?: TypedRequest, persist = true) {
    if (!isDeveloperQuotaRecordId(id)) throw iamAccountDenied();
    const { principal } = this.principal(userId, request);
    const target = await this.repository.target(principal, id);
    if (!target || target.id !== id || target.status !== 1) throw iamAccountDenied();
    const guard = await this.guard(
      userId,
      request,
      Permission.DEVELOPER_QUOTA_MANAGE,
      "quyan:developer:DeleteQuotaOverride",
      platformDeveloperQuotaArn(id),
    );
    if (!persist) {
      await guard.users.recheck();
      return undefined;
    }
    return this.repository.remove(target, guard);
  }
}
