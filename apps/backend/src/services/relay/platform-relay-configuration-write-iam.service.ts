import { performance } from "node:perf_hooks";
import { iamLegacyPermissionsForAction, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformRelayConfigurationArn } from "@/iam/resources/platform-relay-configuration-resources";
import {
  platformModelPricingArn,
  platformModelPricingCollectionArn,
  isModelPricingRecordId,
} from "@/iam/resources/platform-model-pricing-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformRelayConfigurationWriteRepository } from "@/store/relay/platform-relay-configuration-write.repository";
import type {
  PlatformRelayConfigurationWriteStore,
  RelayConfigurationWriteGuard,
} from "@/store/relay/platform-relay-configuration-write.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { RelayConfigService } from "./relay-config.service";
import { updateRelayConfigBodySchema } from "@/api/schema/relay/relay-config.schema";
import { prepareRelayConfigurationUpdate } from "@/util/relay-configuration-update";
import { normalizeModelPricingCreate } from "@/util/model-pricing-input";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { UpdateRelayConfigRequest, RelayConfigDto } from "@/api/dto/relay/relay-config.dto";
const action = "quyan:relay:UpdateConfiguration";
export class PlatformRelayConfigurationWriteIamService {
  private static instance: PlatformRelayConfigurationWriteIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformRelayConfigurationWriteStore = PlatformRelayConfigurationWriteRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly legacy: Pick<
      RelayConfigService,
      "updateRelayConfig" | "logConfigurationUpdate"
    > = RelayConfigService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformRelayConfigurationWriteIamService());
  }
  private normalize(input: UpdateRelayConfigRequest) {
    const parsed = updateRelayConfigBodySchema.strict().safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid relay configuration update", undefined, { messageKey: "errors.badRequest" });
    let data: typeof parsed.data, prepared: ReturnType<typeof prepareRelayConfigurationUpdate>;
    try {
      data = structuredClone(parsed.data);
      prepared = prepareRelayConfigurationUpdate(data);
    } catch {
      throw new BadRequestError("Invalid relay configuration update", undefined, { messageKey: "errors.badRequest" });
    }
    if (prepared.modelRates) {
      if (new Set(prepared.modelRates.map((rate) => rate.model)).size !== prepared.modelRates.length)
        throw new BadRequestError("Duplicate model rates", undefined, { messageKey: "errors.badRequest" });
      for (const rate of prepared.modelRates)
        normalizeModelPricingCreate({
          model: rate.model,
          pricingType: rate.pricingType,
          inputPrice: rate.inputPrice ?? 0,
          outputPrice: rate.outputPrice ?? 0,
          fixedPrice: rate.fixedPrice,
          cacheCreationMultiplier: rate.cacheCreationMultiplier,
          cacheReadMultiplier: rate.cacheReadMultiplier,
          supportedFormats: rate.supportedFormats,
        });
    }
    return { data, prepared };
  }
  private async decisions(
    principal: IamPrincipal,
    request: TypedRequest,
    operation: string,
    resources: readonly string[],
  ) {
    const allowed = new Set<string>(),
      unique = [...new Set(resources)];
    for (let index = 0; index < unique.length; index += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = unique.slice(index, index + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
        start = performance.now(),
        results = await this.iam.authorizeMany({
          principal,
          action: operation,
          resources: batch,
          context: requestConditionContext(request, principal),
        });
      if (!Array.isArray(results) || results.length !== batch.length || results.some((result) => !result))
        throw iamAccountDenied();
      const records = (request.iamDecisions ??= []);
      records.splice(0, Math.max(0, records.length + results.length - IAM_AUTHORIZATION_LIMITS.resourcesPerRequest));
      results.forEach((result, i) => {
        records.push({ ...result, action: operation, resource: batch[i]! });
        auditIamDecision({
          requestId: request.res?.locals.requestId,
          principal,
          action: operation,
          resource: batch[i]!,
          result,
          evaluationLatencyMs: performance.now() - start,
          authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
          ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
        });
        if (result.decision === "Allow") allowed.add(batch[i]!);
      });
    }
    return allowed;
  }
  private async prepare(input: UpdateRelayConfigRequest, principal: IamPrincipal, request: TypedRequest) {
    const normalized = this.normalize(input),
      required = iamLegacyPermissionsForAction(action);
    if (required.length !== 1) throw iamAccountDenied();
    const snapshot = await this.snapshots.snapshot(principal, required),
      hash = fingerprintIamPolicies(await this.iam.loadPolicies(principal)),
      revision = await this.repository.authorizationRevision(principal);
    const requireResources = async (resources: readonly string[]) => {
      if ((await this.decisions(principal, request, action, resources)).size !== new Set(resources).size)
        throw iamAccountDenied();
    };
    await requireResources([platformRelayConfigurationArn()]);
    const models = normalized.prepared.modelRates?.map((rate) => rate.model),
      target = await this.repository.prepare(models);
    if (
      !target ||
      (target.config !== null && (target.config.status !== 1 || !isModelPricingRecordId(target.config.id))) ||
      target.prices.some((row) => !isModelPricingRecordId(row.id)) ||
      new Set(target.prices.map((row) => row.id)).size !== target.prices.length
    )
      throw iamAccountDenied();
    const resources = [platformRelayConfigurationArn(), ...target.prices.map((row) => platformModelPricingArn(row.id))];
    if (models?.some((model) => !target.prices.some((row) => row.model === model)))
      resources.push(platformModelPricingCollectionArn());
    const recheck = async () => {
      await this.snapshots.recheck(principal, required, snapshot);
      if (
        (await this.repository.authorizationRevision(principal)) !== revision ||
        fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== hash
      )
        throw iamAccountDenied();
      await requireResources(resources);
    };
    await recheck();
    const guard: RelayConfigurationWriteGuard = {
      group: snapshot.group,
      authorizationRevision: revision,
      users: { principal, targetUserId: principal.subjectUserId, users: snapshot.users, recheck },
      requireResources,
      readablePricingIds: async (ids) => {
        if (ids.some((id) => !isModelPricingRecordId(id)) || new Set(ids).size !== ids.length) throw iamAccountDenied();
        const allowed = await this.decisions(
          principal,
          request,
          "quyan:relay:GetConfiguration",
          ids.map((id) => platformModelPricingArn(id)),
        );
        return new Set(ids.filter((id) => allowed.has(platformModelPricingArn(id))));
      },
    };
    return { ...normalized, target, guard };
  }
  async write(input: UpdateRelayConfigRequest, request: TypedRequest): Promise<RelayConfigDto> {
    const identity = getIamPrincipal(request);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    const principal = { ...identity };
    if (env.security.iamAuthorizationMode !== "enforce") {
      if (
        !(
          await this.permissions.checkUserPermissions(principal.subjectUserId, iamLegacyPermissionsForAction(action), {
            assumedRoleSessionId: principal.roleSessionId,
          })
        ).hasPermission
      )
        throw iamAccountDenied();
      if (env.security.iamAuthorizationMode === "shadow")
        try {
          await this.prepare(input, principal, request);
        } catch {
          getLogger("RelayConfigurationWriteIam", LogCategory.SECURITY).warn(
            "Relay configuration IAM shadow evaluation failed",
            { action, reason: "iam-evaluation-denied-or-unavailable" },
          );
        }
      return this.legacy.updateRelayConfig(input, principal.subjectUserId, request);
    }
    const context = await this.prepare(input, principal, request),
      result = await this.repository.write(
        context.target,
        context.prepared.configData,
        context.prepared.modelRates,
        context.guard,
      );
    await this.legacy.logConfigurationUpdate(context.data, principal.subjectUserId, result.id, request);
    return result;
  }
}
