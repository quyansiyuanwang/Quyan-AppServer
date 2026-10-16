import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { RelayChannelHealthReadRepository } from "@/store/relay/relay-channel-health-read.repository";
import type { RelayChannelHealthReadOptions } from "@/store/relay/relay-channel-health-read.repository";
import { projectRelayChannelHealth, projectRelayAutomaticPoolHealth } from "./relay-channel-health-projection";
import { RelayChannelHealthService } from "./relay-channel-health.service";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PermissionService } from "../users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type {
  RelayChannelHealthDto,
  RelayAutomaticPoolHealthDto,
  RelayChannelHealthOverviewDto,
} from "@/api/dto/relay/relay-channel.dto";
type HealthReadResult =
  | RelayChannelHealthDto
  | RelayAutomaticPoolHealthDto
  | RelayChannelHealthOverviewDto
  | RelayAutomaticPoolHealthDto[];
const metadataAction = "quyan:relay:ReadChannelPoolHealthMetadata";
export class RelayChannelHealthReadIamService {
  private static instance: RelayChannelHealthReadIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelHealthReadIamService());
  }
  async read<T extends HealthReadResult>(
    options: RelayChannelHealthReadOptions,
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<T>,
  ) {
    const mode = env.security.iamAuthorizationMode,
      action =
        "quyan:relay:" +
        (
          {
            overview: "ListChannelHealth",
            single: "GetChannelHealth",
            "automatic-pools": "ListAutomaticPoolHealth",
          } as const
        )[options.kind],
      needsMetadata = options.kind !== "overview",
      eligibility = needsMetadata
        ? [Permission.RELAY_CHANNEL_HEALTH_READ, Permission.RELAY_CHANNEL_POOL_METADATA_READ]
        : [Permission.RELAY_CHANNEL_HEALTH_READ];
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const identity = getIamPrincipal(request);
    if (
      !identity ||
      identity.subjectUserId !== actorUserId ||
      identity.principalUserId !== actorUserId ||
      request.oauthAccessToken
    )
      throw iamAccountDenied();
    const principal: IamPrincipal = { ...identity };
    if (
      mode !== "enforce" &&
      !(
        await Promise.all(
          eligibility.map((permission) =>
            PermissionService.getInstance().checkUserPermissions(actorUserId, [permission], {
              assumedRoleSessionId: principal.roleSessionId,
            }),
          ),
        )
      ).every((result) => result.hasPermission)
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const evaluate = async (hydrate: boolean) => {
      const iam = IamAuthorizationService.getInstance(),
        snapshots = PlatformManagementReadRepository.getInstance(),
        keyId = request.accessKey?.id;
      const assertRequest = () => {
        if (
          JSON.stringify(getIamPrincipal(request)) !== JSON.stringify(principal) ||
          request.accessKey?.id !== keyId ||
          Boolean(request.oauthAccessToken)
        )
          throw iamAccountDenied();
      };
      assertRequest();
      const snapshot = await Promise.all(eligibility.map((permission) => snapshots.snapshot(principal, permission))),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyRevision = await captureIamAccessKeyRevision(principal, keyId);
      const recheck = async () => {
        assertRequest();
        await Promise.all(
          eligibility.map((permission, index) => snapshots.recheck(principal, permission, snapshot[index]!)),
        );
        if (
          fingerprintIamPolicies(await iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId)) !== keyRevision
        )
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck();
      const result = await RelayChannelHealthReadRepository.getInstance().read(
        principal,
        options,
        async (resources) => {
          const primary = await platformCollectionDecisions(iam, { principal, action, request, resources });
          if (!needsMetadata) return primary;
          const secondary = await platformCollectionDecisions(iam, {
            principal,
            action: metadataAction,
            request,
            resources,
          });
          return primary.map((value, index) =>
            value === "ExplicitDeny" || secondary[index] === "ExplicitDeny"
              ? "ExplicitDeny"
              : value === "Allow" && secondary[index] === "Allow"
                ? "Allow"
                : "ImplicitDeny",
          );
        },
        recheck,
        hydrate
          ? async ({ targets, members }) => {
              const health = RelayChannelHealthService.getInstance(),
                now = new Date();
              if (options.kind === "overview") {
                const values = await health.getHealthMap(
                  targets.map((row) => row.id),
                  now,
                );
                return {
                  windowMinutes: RelayChannelHealthService.constants.windowMinutes,
                  channels: targets
                    .map((row) => ({
                      ...projectRelayChannelHealth(row, values.get(row.id)),
                      name: row.name,
                      enabled: row.status === RELAY_CHANNEL_STATUS.ENABLED,
                      channelType: "standalone" as const,
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name) || a.channelId.localeCompare(b.channelId)),
                } as T;
              }
              const results = await Promise.all(
                targets.map(async (row) =>
                  row.channelType === "automatic-proxy-pool"
                    ? projectRelayAutomaticPoolHealth(row, members(row), health, now)
                    : projectRelayChannelHealth(row, await health.getHealth(row.id, now)),
                ),
              );
              if (options.kind === "single") {
                if (!results[0]) throw iamAccountDenied();
                return results[0] as T;
              }
              return results as T;
            }
          : undefined,
      );
      await recheck();
      return result;
    };
    if (mode === "enforce") {
      const result = await evaluate(true);
      if (result === undefined) throw iamAccountDenied();
      return result;
    }
    try {
      await evaluate(false);
    } catch {
      getLogger("RelayChannelHealthReadIam", LogCategory.SECURITY).warn("Channel health shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
