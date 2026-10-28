import { iamLegacyPermissionsForAction } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformRelayConfigurationArn } from "@/iam/resources/platform-relay-configuration-resources";
import { platformModelPricingArn, isModelPricingRecordId } from "@/iam/resources/platform-model-pricing-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformRelayConfigurationReadRepository } from "@/store/relay/platform-relay-configuration-read.repository";
import type {
  PlatformRelayConfigurationReadStore,
  RelayConfigurationReadTarget,
} from "@/store/relay/platform-relay-configuration-read.store";
import { PlatformMetadataCollectionIamService } from "@/services/system/platform-metadata-collection-iam.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { RelayConfigService } from "./relay-config.service";
import { projectRelayConfiguration, projectRelayModelRates } from "./relay-configuration-projection";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { ModelPricing } from "@prisma/client";
import type { RelayConfigDto } from "@/api/dto/relay/relay-config.dto";
const action = "quyan:relay:GetConfiguration";
export class PlatformRelayConfigurationReadIamService {
  private static instance: PlatformRelayConfigurationReadIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformRelayConfigurationReadStore = PlatformRelayConfigurationReadRepository.getInstance(),
    private readonly reports: Pick<RelayConfigService, "getRelayConfig"> = RelayConfigService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformRelayConfigurationReadIamService());
  }
  async read(request: TypedRequest): Promise<RelayConfigDto> {
    const identity = getIamPrincipal(request),
      required = iamLegacyPermissionsForAction(action);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !required.length ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    const principal = { ...identity };
    const native = async (hydrate: boolean) => {
      let configuration: RelayConfigurationReadTarget | undefined;
      const targets: RelayConfigurationReadTarget[] = [];
      return new PlatformMetadataCollectionIamService(
        this.iam,
        this.snapshots,
        this.repository,
        (target) => {
          if (!/^[a-f0-9]{64}$/.test(target.revision)) throw iamAccountDenied();
          if (
            target.source === "config" &&
            target.id === "config_default" &&
            (target.recordId === null || isModelPricingRecordId(target.recordId))
          )
            return platformRelayConfigurationArn();
          if (
            target.source === "pricing" &&
            isModelPricingRecordId(target.recordId) &&
            target.id === "pricing_" + target.recordId
          )
            return platformModelPricingArn(target.recordId);
          throw iamAccountDenied();
        },
        (target) => [target.source, target.recordId, target.revision],
      ).read(
        action,
        principal,
        request,
        { cutoff: new Date() },
        hydrate
          ? {
              visit: async (rows) => {
                for (const row of rows)
                  if (row.source === "config") {
                    if (configuration) throw iamAccountDenied();
                    configuration = row;
                  } else targets.push(row);
              },
              finish: async () => {
                if (!configuration) throw iamAccountDenied();
                const config = await this.repository.hydrateConfiguration(configuration);
                if (
                  configuration.recordId === null
                    ? config !== null
                    : !config ||
                      config.id !== configuration.recordId ||
                      config.status !== 1 ||
                      config.createTime.getTime() !== configuration.createTime.getTime() ||
                      config.updateTime.getTime() !== configuration.updateTime.getTime()
                )
                  throw iamAccountDenied();
                const prices: ModelPricing[] = [];
                for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
                  const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
                    rows = await this.repository.hydratePricing(batch);
                  if (
                    rows.length !== batch.length ||
                    new Set(rows.map((row) => row.id)).size !== rows.length ||
                    rows.some(
                      (row) =>
                        !PlatformMetadataCollectionIamService.valid(row) ||
                        !batch.some(
                          (target) =>
                            target.recordId === row.id &&
                            target.createTime.getTime() === row.createTime.getTime() &&
                            target.updateTime.getTime() === row.updateTime.getTime(),
                        ),
                    )
                  )
                    throw iamAccountDenied();
                  prices.push(...rows);
                }
                prices.sort((a, b) => a.model.localeCompare(b.model));
                return projectRelayConfiguration(config, projectRelayModelRates(prices));
              },
            }
          : undefined,
      );
    };
    if (env.security.iamAuthorizationMode !== "enforce") {
      if (
        !(
          await this.permissions.checkUserPermissions(principal.subjectUserId, required, {
            assumedRoleSessionId: principal.roleSessionId,
          })
        ).hasPermission
      )
        throw iamAccountDenied();
      if (env.security.iamAuthorizationMode === "shadow")
        try {
          await native(false);
        } catch {
          getLogger("RelayConfigurationReadIam", LogCategory.SECURITY).warn(
            "Relay configuration IAM shadow evaluation failed",
            { action, reason: "iam-evaluation-denied-or-unavailable" },
          );
        }
      return this.reports.getRelayConfig();
    }
    const result = await native(true);
    if (!result) throw iamAccountDenied();
    return result;
  }
}
