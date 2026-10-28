import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { captureIamOAuthRevision } from "@/store/users/iam-oauth-authority";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { RelayChannelTopologyAuditRepository } from "@/store/relay/relay-channel-topology-audit.repository";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PermissionService } from "../users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { RelayChannelTopologyAuditDto } from "@/api/dto/relay/relay-channel.dto";
const action = "quyan:relay:AuditChannelTopology";
export class RelayChannelTopologyAuditIamService {
  private static instance: RelayChannelTopologyAuditIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelTopologyAuditIamService());
  }
  async read(
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayChannelTopologyAuditDto>,
  ) {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const identity = getIamPrincipal(request);
    if (!identity || identity.subjectUserId !== actorUserId || identity.principalUserId !== actorUserId)
      throw iamAccountDenied();
    const principal: IamPrincipal = { ...identity };
    if (
      mode !== "enforce" &&
      !(
        await PermissionService.getInstance().checkUserPermissions(actorUserId, [Permission.RELAY_CHANNEL_READ], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
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
      const snapshot = await snapshots.snapshot(principal, Permission.RELAY_CHANNEL_READ),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyRevision = await captureIamAccessKeyRevision(principal, keyId),
        oauthRevision = await captureIamOAuthRevision(principal, oauth, [Permission.RELAY_CHANNEL_READ]);
      const recheck = async () => {
        assertRequest();
        await snapshots.recheck(principal, Permission.RELAY_CHANNEL_READ, snapshot);
        if (
          fingerprintIamPolicies(await iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId)) !== keyRevision ||
          (await captureIamOAuthRevision(principal, oauth, [Permission.RELAY_CHANNEL_READ])) !== oauthRevision
        )
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck();
      const result = await RelayChannelTopologyAuditRepository.getInstance().audit(
        principal,
        (resources) => platformCollectionDecisions(iam, { principal, action, request, resources }),
        recheck,
        hydrate,
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
      getLogger("RelayTopologyAuditIam", LogCategory.SECURITY).warn("Topology audit shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
