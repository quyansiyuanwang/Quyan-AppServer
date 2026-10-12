import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
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
import {
  normalizeModelPricingCreate,
  normalizeModelPricingUpdate,
  normalizeModelPricingImportBatch,
} from "@/util/model-pricing-input";
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
  private async evaluateMany(principal: IamPrincipal, request: TypedRequest, action: string, ids: readonly string[]) {
    if (!ids.length) return;
    if (
      ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !isModelPricingRecordId(id))
    )
      throw iamAccountDenied();
    const resources = ids.map((id) => platformModelPricingArn(id)),
      start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (!Array.isArray(results) || results.length !== resources.length || results.some((result) => !result))
      throw iamAccountDenied();
    results.forEach((result, i) => {
      (request.iamDecisions ??= []).push({ ...result, action, resource: resources[i] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[i],
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
      recheckEntries: async (ids) => this.evaluateMany(principal, identity.request, action, ids),
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
  async importModels(
    input: readonly CreateModelPricingRequest[],
    userId: string,
    request?: TypedRequest,
    persist = true,
  ) {
    const models = normalizeModelPricingImportBatch(input);
    const { principal } = this.principal(userId, request);
    const targets = await this.repository.prepareImport(principal, models);
    if (
      targets.length !== models.length ||
      targets.some(
        (target, i) =>
          target &&
          (!isModelPricingRecordId(target.id) ||
            target.model !== models[i].model ||
            !(target.updateTime instanceof Date) ||
            !Number.isFinite(target.updateTime.getTime())),
      )
    )
      throw iamAccountDenied();
    const guard = await this.guard(
      userId,
      request,
      Permission.MODEL_PRICING_UPDATE,
      "quyan:model_pricing:ImportPricing",
      platformModelPricingCollectionArn(),
    );
    await guard.recheckEntries(targets.flatMap((target) => (target ? [target.id] : [])));
    if (!persist) {
      await guard.users.recheck();
      return undefined;
    }
    return this.repository.importModels(models, targets, guard);
  }
}
