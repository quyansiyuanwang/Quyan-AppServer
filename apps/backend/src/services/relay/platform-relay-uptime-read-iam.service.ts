import { iamLegacyPermissionsForAction } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformRelayUptimeArn, platformRelayUptimeMonitorArn } from "@/iam/resources/platform-relay-uptime-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformRelayConfigurationReadRepository } from "@/store/relay/platform-relay-configuration-read.repository";
import type {
  RelayConfigurationReadTarget,
  PlatformRelayConfigurationReadStore,
} from "@/store/relay/platform-relay-configuration-read.store";
import { PlatformResourceReadIamService } from "@/services/system/platform-resource-read-iam.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { RelayUptimeService, relayUptimeConfiguration } from "./relay-uptime.service";
import { relayUptimeTargets, projectRelayUptimeResponse } from "@/util/relay-uptime-projection";
import { getLogger, LogCategory } from "@/util/logger";
import type { UptimeResponse } from "@/api/dto/relay/relay-config.dto";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:GetUptimeStatus";
type SourceStore = Pick<PlatformRelayConfigurationReadStore, "hydrateConfiguration"> & {
  configurationTarget(): Promise<RelayConfigurationReadTarget>;
};
export class PlatformRelayUptimeReadIamService {
  private static instance: PlatformRelayUptimeReadIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: SourceStore = PlatformRelayConfigurationReadRepository.getInstance(),
    private readonly reports: Pick<
      RelayUptimeService,
      "getStatus" | "fromConfiguration"
    > = RelayUptimeService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformRelayUptimeReadIamService());
  }
  private async configuration(target: RelayConfigurationReadTarget) {
    const row = await this.repository.hydrateConfiguration(target);
    try {
      return relayUptimeConfiguration(row);
    } catch {
      throw iamAccountDenied();
    }
  }
  async read(request: TypedRequest): Promise<UptimeResponse> {
    const identity = getIamPrincipal(request),
      mode = env.security.iamAuthorizationMode;
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !["legacy", "shadow", "enforce"].includes(mode)
    )
      throw iamAccountDenied();
    const principal = { ...identity };
    const native = (prior?: UptimeResponse) =>
      new PlatformResourceReadIamService(this.iam, this.snapshots).read(
        action,
        principal,
        request,
        platformRelayUptimeArn(),
        async (guard) => {
          const target = await this.repository.configurationTarget();
          const signature = (value: RelayConfigurationReadTarget) =>
            JSON.stringify([
              value.id,
              value.source,
              value.recordId,
              value.status,
              value.revision,
              value.createTime,
              value.updateTime,
            ]);
          if (
            target.source !== "config" ||
            target.id !== "config_default" ||
            target.status !== 1 ||
            !/^[a-f0-9]{64}$/.test(target.revision)
          )
            throw iamAccountDenied();
          guard.trackSource(async () => {
            if (signature(await this.repository.configurationTarget()) !== signature(target)) throw iamAccountDenied();
          });
          const response = prior ?? (await this.reports.fromConfiguration(await this.configuration(target)));
          let targets;
          try {
            targets = relayUptimeTargets(response);
          } catch {
            throw iamAccountDenied();
          }
          const allowed = await guard.allowed(targets.map((row) => platformRelayUptimeMonitorArn(row.id)));
          const resultIds = new Set(
            targets.filter((row) => allowed.has(platformRelayUptimeMonitorArn(row.id))).map((row) => row.id),
          );
          let result;
          try {
            result = projectRelayUptimeResponse(response, targets, resultIds);
          } catch {
            throw iamAccountDenied();
          }
          await guard.recheck();
          if (signature(await this.repository.configurationTarget()) !== signature(target)) throw iamAccountDenied();
          return result;
        },
      );
    if (mode === "enforce") return native();
    if (
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, iamLegacyPermissionsForAction(action), {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    const result = await this.reports.getStatus();
    if (mode === "shadow")
      try {
        await native(result);
      } catch {
        getLogger("RelayUptimeIam", LogCategory.SECURITY).warn("Uptime IAM shadow evaluation failed", {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    return result;
  }
}
