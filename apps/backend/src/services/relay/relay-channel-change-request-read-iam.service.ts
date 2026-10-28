import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import {
  assertIamAccountPrincipal,
  IamAccountUserRepository,
  iamAccountDenied,
} from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import {
  RelayChannelChangeRequestReadRepository,
  type RelayChannelChangeRequestReadQuery,
} from "@/store/relay/relay-channel-change-request-read.repository";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PermissionService } from "../users/permission.service";
import { projectRelayChannelChangeRequest } from "./relay-channel-change-request-projection";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export class RelayChannelChangeRequestReadIamService {
  private static instance: RelayChannelChangeRequestReadIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelChangeRequestReadIamService());
  }
  async list(
    request: TypedRequest | undefined,
    query: RelayChannelChangeRequestReadQuery,
    legacy: () => Promise<{
      items: ReturnType<typeof projectRelayChannelChangeRequest>[];
      total: number;
      page: number;
      pageSize: number;
    }>,
  ) {
    query = { ...query };
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const identity = getIamPrincipal(request);
    if (!identity || identity.subjectUserId !== identity.principalUserId || request.oauthAccessToken)
      throw iamAccountDenied();
    const principal: IamPrincipal = { ...identity },
      permission = query.mine ? Permission.RELAY_CHANNEL_SUBMIT : Permission.RELAY_CHANNEL_REVIEW,
      action = query.mine ? "quyan:relay:ListMyChannelChangeRequests" : "quyan:relay:ListChannelChangeRequests";
    if (
      mode !== "enforce" &&
      !(
        await PermissionService.getInstance().checkUserPermissions(principal.subjectUserId, [permission], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const evaluate = async (hydrate: boolean) => {
      const iam = IamAuthorizationService.getInstance(),
        keyId = request.accessKey?.id;
      const assertRequest = () => {
        if (
          JSON.stringify(getIamPrincipal(request)) !== JSON.stringify(principal) ||
          request.accessKey?.id !== keyId ||
          request.oauthAccessToken
        )
          throw iamAccountDenied();
      };
      const snapshot = async () => {
        assertRequest();
        await assertIamAccountPrincipal(principal);
        return query.mine
          ? IamAccountUserRepository.getInstance().targets(principal, [
              ...new Set([principal.subjectUserId, principal.accountOwnerId]),
            ])
          : PlatformManagementReadRepository.getInstance().snapshot(principal, permission);
      };
      const expected = JSON.stringify(await snapshot()),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyRevision = await captureIamAccessKeyRevision(principal, keyId);
      const recheck = async () => {
        if (
          JSON.stringify(await snapshot()) !== expected ||
          fingerprintIamPolicies(await iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId)) !== keyRevision
        )
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck();
      const result = await RelayChannelChangeRequestReadRepository.getInstance().list(
        principal,
        query,
        (resources) => platformCollectionDecisions(iam, { principal, action, request, resources }),
        recheck,
        hydrate,
      );
      await recheck();
      return { ...result, items: hydrate ? result.items.map(projectRelayChannelChangeRequest) : [] };
    };
    if (mode === "enforce") return evaluate(true);
    try {
      await evaluate(false);
    } catch {
      getLogger("RelayChannelChangeRequestIam", LogCategory.SECURITY).warn(
        "Channel change request shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}
