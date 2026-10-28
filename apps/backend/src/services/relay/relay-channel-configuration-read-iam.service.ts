import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { captureIamOAuthRevision } from "@/store/users/iam-oauth-authority";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { RelayChannelConfigurationReadRepository } from "@/store/relay/relay-channel-configuration-read.repository";
import type { RelayChannelConfigurationReadOptions } from "@/store/relay/relay-channel-configuration-read.repository";
import { projectRelayChannelConfiguration } from "./relay-channel-configuration-projection";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import { formatRelayRequestFormats } from "@quyan/shared";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PermissionService } from "../users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { RelayChannelDto } from "@/api/dto/relay/relay-channel.dto";
const eligibility = [Permission.RELAY_CHANNEL_READ, Permission.RELAY_CHANNEL_REVIEW] as const;
export class RelayChannelConfigurationReadIamService {
  private static instance: RelayChannelConfigurationReadIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelConfigurationReadIamService());
  }
  async read(
    operation: "ListChannels" | "GetChannel",
    options: RelayChannelConfigurationReadOptions,
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayChannelDto[]>,
  ) {
    const mode = env.security.iamAuthorizationMode,
      action = "quyan:relay:" + operation;
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
      (operation === "GetChannel" && request.oauthAccessToken)
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
      ).some((result) => result.hasPermission)
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const evaluate = async (hydrate: boolean) => {
      const iam = IamAuthorizationService.getInstance(),
        snapshots = PlatformManagementReadRepository.getInstance(),
        keyId = request.accessKey?.id,
        oauth = request.oauthAccessToken
          ? { id: request.oauthAccessToken.id, clientId: request.oauthAccessToken.oauthClientId }
          : undefined;
      const assertRequest = () => {
        if (
          JSON.stringify(getIamPrincipal(request)) !== JSON.stringify(principal) ||
          request.accessKey?.id !== keyId ||
          (oauth
            ? request.oauthAccessToken?.id !== oauth.id ||
              request.oauthAccessToken.oauthClientId !== oauth.clientId ||
              request.oauthAccessToken.userId !== actorUserId
            : Boolean(request.oauthAccessToken))
        )
          throw iamAccountDenied();
      };
      assertRequest();
      const snapshot = await snapshots.snapshot(principal, eligibility),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyRevision = await captureIamAccessKeyRevision(principal, keyId),
        oauthRevision = await captureIamOAuthRevision(principal, oauth, [Permission.RELAY_CHANNEL_READ]);
      const recheck = async () => {
        assertRequest();
        await snapshots.recheck(principal, eligibility, snapshot);
        if (
          fingerprintIamPolicies(await iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId)) !== keyRevision ||
          (await captureIamOAuthRevision(principal, oauth, [Permission.RELAY_CHANNEL_READ])) !== oauthRevision
        )
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck();
      const result = await RelayChannelConfigurationReadRepository.getInstance().read(
        principal,
        options,
        (resources) => platformCollectionDecisions(iam, { principal, action, request, resources }),
        recheck,
        hydrate
          ? async ({ records, context }) =>
              Promise.all(
                records.map(async ({ source, presence }) => {
                  const dto = projectRelayChannelConfiguration(source, presence),
                    capabilities = await RelayPoolResolverService.getInstance().resolveChannelCapabilities(
                      source.id,
                      context,
                    );
                  dto.allowedModels = [...new Set(capabilities.map((value) => value.catalogModelName))].sort();
                  if (["pooled", "automatic-proxy-pool"].includes(dto.channelType))
                    dto.allowedFormats = formatRelayRequestFormats([
                      ...new Set(capabilities.flatMap((value) => value.supportedRequestFormats)),
                    ]);
                  return dto;
                }),
              )
          : undefined,
      );
      await recheck();
      return result;
    };
    if (mode === "enforce") {
      const result = await evaluate(true);
      if (!result) throw iamAccountDenied();
      return result;
    }
    try {
      await evaluate(false);
    } catch {
      getLogger("RelayChannelConfigurationReadIam", LogCategory.SECURITY).warn(
        "Channel configuration shadow evaluation failed",
        {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        },
      );
    }
    return legacy();
  }
}
