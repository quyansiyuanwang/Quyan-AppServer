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
import {
  RelayChannelSubmissionReadRepository,
  type RelayChannelSubmissionReadQuery,
} from "@/store/relay/relay-channel-submission-read.repository";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PermissionService } from "../users/permission.service";
import { projectRelayChannelConfiguration } from "./relay-channel-configuration-projection";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import type { RelayChannelDto } from "@/api/dto/relay/relay-channel.dto";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export class RelayChannelSubmissionReadIamService {
  private static instance: RelayChannelSubmissionReadIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelSubmissionReadIamService());
  }
  async list(
    request: TypedRequest | undefined,
    query: RelayChannelSubmissionReadQuery,
    legacy: () => Promise<{
      items: RelayChannelDto[];
      total: number;
      page: number;
      pageSize: number;
    }>,
    actorUserId: string,
  ) {
    query = { ...query };
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const identity = getIamPrincipal(request);
    if (
      !identity ||
      identity.subjectUserId !== actorUserId ||
      identity.subjectUserId !== identity.principalUserId ||
      request.oauthAccessToken
    )
      throw iamAccountDenied();
    const principal: IamPrincipal = { ...identity },
      permission = Permission.RELAY_CHANNEL_SUBMIT,
      action = "quyan:relay:ListMyChannelSubmissions";
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
          env.security.iamAuthorizationMode !== mode ||
          JSON.stringify(getIamPrincipal(request)) !== JSON.stringify(principal) ||
          request.accessKey?.id !== keyId ||
          request.oauthAccessToken
        )
          throw iamAccountDenied();
      };
      const snapshot = async () => {
        assertRequest();
        await assertIamAccountPrincipal(principal);
        const ids = [...new Set([principal.subjectUserId, principal.accountOwnerId])];
        const users = await IamAccountUserRepository.getInstance().targets(principal, ids);
        if (users.length !== ids.length || ids.some((id) => !users.some((user) => user.id === id)))
          throw iamAccountDenied();
        return users.sort((a, b) => a.id.localeCompare(b.id));
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
      const result = await RelayChannelSubmissionReadRepository.getInstance().list(
        principal,
        query,
        (resources) => platformCollectionDecisions(iam, { principal, action, request, resources }),
        recheck,
        hydrate
          ? async (records, context) =>
              Promise.all(
                records.map(async ({ source, presence }) => {
                  const dto = projectRelayChannelConfiguration(source, presence);
                  const capabilities = await RelayPoolResolverService.getInstance().resolveChannelCapabilities(
                    source.id,
                    context,
                  );
                  dto.allowedModels = [...new Set(capabilities.map((value) => value.catalogModelName))].sort();
                  return dto;
                }),
              )
          : undefined,
      );
      await recheck();
      return result;
    };
    if (mode === "enforce") return evaluate(true);
    try {
      await evaluate(false);
    } catch {
      getLogger("RelayChannelSubmissionReadIam", LogCategory.SECURITY).warn(
        "Channel submission shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}
