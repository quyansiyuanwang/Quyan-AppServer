import { performance } from "node:perf_hooks";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { platformOjPricingArn, platformOjPricingCollectionArn } from "@/iam/resources/platform-oj-pricing-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformOjPricingWriteRepository } from "@/store/oj-submitter/platform-oj-pricing-write.repository";
import type {
  PlatformOjPricingWriteStore,
  PlatformOjPricingWriteGuard,
} from "@/store/oj-submitter/platform-oj-pricing-write.store";
import {
  createOJModelPricingBodySchema,
  updateOJModelPricingBodySchema,
  ojPricingModelParamsSchema,
} from "@/api/schema/oj-submitter/oj-submitter.schema";
import type { CreateOJModelPricingRequest, UpdateOJModelPricingRequest } from "@/api/dto/oj-submitter/oj-qa.dto";
import { BadRequestError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
export class PlatformOjPricingWriteIamService {
  private static instance: PlatformOjPricingWriteIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformOjPricingWriteStore = PlatformOjPricingWriteRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformOjPricingWriteIamService());
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
    const guard: PlatformOjPricingWriteGuard = {
      permission,
      group: snapshot.group,
      users: { principal, targetUserId: userId, users: snapshot.users, recheck },
      recheckEntry: async (id) => this.evaluate(principal, identity.request, action, platformOjPricingArn(id)),
    };
    return guard;
  }
  async create(input: CreateOJModelPricingRequest, userId: string, request?: TypedRequest, persist = true) {
    const parsed = createOJModelPricingBodySchema.strict().safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid OJ pricing", undefined, { messageKey: "errors.badRequest" });
    const guard = await this.guard(
      userId,
      request,
      Permission.OJ_PRICING_UPDATE,
      "quyan:oj:CreatePricing",
      platformOjPricingCollectionArn(),
    );
    if (!persist) {
      await guard.users.recheck();
      return undefined;
    }
    return this.repository.create(parsed.data, guard);
  }
  async mutate(
    operation: "update" | "delete",
    model: string,
    input: UpdateOJModelPricingRequest,
    userId: string,
    request?: TypedRequest,
    persist = true,
  ) {
    const parsed = ojPricingModelParamsSchema.strict().safeParse({ model });
    const body = updateOJModelPricingBodySchema.strict().safeParse(input);
    if (!parsed.success || !body.success || !["update", "delete"].includes(operation))
      throw new BadRequestError("Invalid OJ pricing mutation", undefined, { messageKey: "errors.badRequest" });
    const { principal } = this.principal(userId, request);
    const target = await this.repository.target(principal, parsed.data.model);
    if (
      !target ||
      target.model !== parsed.data.model ||
      target.status !== 1 ||
      !(target.updateTime instanceof Date) ||
      !Number.isFinite(target.updateTime.getTime())
    )
      throw iamAccountDenied();
    const action = operation === "update" ? "quyan:oj:UpdatePricing" : "quyan:oj:DeletePricing";
    const guard = await this.guard(
      userId,
      request,
      Permission.OJ_PRICING_UPDATE,
      action,
      platformOjPricingArn(target.id),
    );
    if (!persist) {
      await guard.users.recheck();
      return undefined;
    }
    return operation === "update"
      ? this.repository.update(target, body.data, guard)
      : this.repository.remove(target, guard);
  }
}
