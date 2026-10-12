import { performance } from "node:perf_hooks";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformModelPricingArn,
  platformModelPricingCollectionArn,
} from "@/iam/resources/platform-model-pricing-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformModelPricingWriteRepository } from "@/store/relay/platform-model-pricing-write.repository";
import type {
  PlatformModelPricingWriteStore,
  PlatformModelPricingWriteGuard,
} from "@/store/relay/platform-model-pricing-write.store";
import { normalizeModelPricingCreate, normalizeModelPricingUpdate } from "@/util/model-pricing-input";
import { isModelPricingRecordId } from "@/iam/resources/platform-model-pricing-resources";
import type { CreateModelPricingRequest, UpdateModelPricingRequest } from "@/api/dto/relay/model-pricing.dto";
import type { TypedRequest } from "@/types/express";
export class PlatformModelPricingWriteIamService {
  private static instance: PlatformModelPricingWriteIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformModelPricingWriteStore = PlatformModelPricingWriteRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformModelPricingWriteIamService());
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
    const guard: PlatformModelPricingWriteGuard = {
      permission,
      group: snapshot.group,
      users: { principal, targetUserId: userId, users: snapshot.users, recheck },
      recheckEntry: async (id) => this.evaluate(principal, identity.request, action, platformModelPricingArn(id)),
    };
    return guard;
  }
  async create(input: CreateModelPricingRequest, userId: string, request?: TypedRequest, persist = true) {
    const data = normalizeModelPricingCreate(input);
    const guard = await this.guard(
      userId,
      request,
      Permission.MODEL_PRICING_UPDATE,
      "quyan:model_pricing:CreatePricing",
      platformModelPricingCollectionArn(),
    );
    if (!persist) {
      await guard.users.recheck();
      return undefined;
    }
    return this.repository.create(data, guard);
  }
  async mutate(
    operation: "update" | "delete",
    id: string,
    input: UpdateModelPricingRequest,
    userId: string,
    request?: TypedRequest,
    persist = true,
  ) {
    const data = normalizeModelPricingUpdate(input);
    if (!isModelPricingRecordId(id) || !["update", "delete"].includes(operation)) throw iamAccountDenied();
    const { principal } = this.principal(userId, request);
    const target = await this.repository.target(principal, id);
    if (
      !target ||
      target.id !== id ||
      target.status !== 1 ||
      !(target.updateTime instanceof Date) ||
      !Number.isFinite(target.updateTime.getTime())
    )
      throw iamAccountDenied();
    const action = operation === "update" ? "quyan:model_pricing:UpdatePricing" : "quyan:model_pricing:DeletePricing";
    const guard = await this.guard(
      userId,
      request,
      Permission.MODEL_PRICING_UPDATE,
      action,
      platformModelPricingArn(target.id),
    );
    if (!persist) {
      await guard.users.recheck();
      return undefined;
    }
    return operation === "update" ? this.repository.update(target, data, guard) : this.repository.remove(target, guard);
  }
}
