import { isDeepStrictEqual as same } from "node:util";
import { iamLegacyPermissionsForAction } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestTransportConditionContext } from "@/iam/request/condition-context";
import { assertIamAccountPrincipal, iamAccountDenied } from "@/store/users/iam-account-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { captureIamOAuthRevision } from "@/store/users/iam-oauth-authority";
import { RelayChannelCatalogReadRepository } from "@/store/relay/relay-channel-catalog-read.repository";
import { PermissionService } from "../users/permission.service";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { projectRelayChannelCatalog } from "./relay-channel-catalog-projection";
import { getLogger, LogCategory } from "@/util/logger";
import type { RelayCatalogOptionDto } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
export class RelayChannelCatalogIamService {
  private static instance: RelayChannelCatalogIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelCatalogIamService());
  }
  async read(actorUserId: string, request: TypedRequest | undefined, legacy: () => Promise<RelayCatalogOptionDto[]>) {
    const mode = env.security.iamAuthorizationMode,
      action = "quyan:relay:ListChannelCatalog";
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const identity = getIamPrincipal(request);
    if (!identity || identity.subjectUserId !== actorUserId || identity.principalUserId !== actorUserId)
      throw iamAccountDenied();
    const principal = { ...identity };
    if (
      mode !== "enforce" &&
      !(
        await Promise.all(
          iamLegacyPermissionsForAction(action).map((permission) =>
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
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId),
        oauth = request.oauthAccessToken
          ? { id: request.oauthAccessToken.id, clientId: request.oauthAccessToken.oauthClientId }
          : undefined,
        scopes = ["relay:channel:read"],
        oauthRevision = await captureIamOAuthRevision(principal, oauth, scopes),
        transport = requestTransportConditionContext(request);
      const assertRequest = () => {
        if (
          env.security.iamAuthorizationMode !== mode ||
          !same(getIamPrincipal(request), principal) ||
          request.accessKey?.id !== keyId ||
          !same(requestTransportConditionContext(request), transport) ||
          (oauth
            ? request.oauthAccessToken?.id !== oauth.id ||
              request.oauthAccessToken.oauthClientId !== oauth.clientId ||
              request.oauthAccessToken.userId !== actorUserId
            : Boolean(request.oauthAccessToken))
        )
          throw iamAccountDenied();
      };
      const recheck = async () => {
        assertRequest();
        await assertIamAccountPrincipal(principal);
        if (
          fingerprintIamPolicies(await iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId)) !== keyRevision ||
          (await captureIamOAuthRevision(principal, oauth, scopes)) !== oauthRevision
        )
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck();
      const observed = new Map<string, string>();
      const decide = async (resources: readonly string[]) => {
        const outcomes = await platformCollectionDecisions(iam, { principal, action, request, resources });
        resources.forEach((resource, index) => {
          const decision = outcomes[index]!;
          if (observed.has(resource) && observed.get(resource) !== decision) throw iamAccountDenied();
          observed.set(resource, decision);
        });
        return outcomes;
      };
      const result = await RelayChannelCatalogReadRepository.getInstance().read(
        principal,
        decide,
        recheck,
        hydrate ? projectRelayChannelCatalog : undefined,
      );
      await recheck();
      // Time-based conditions and out-of-transaction revocation must still hold at response release.
      const entries = [...observed],
        limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
      for (let offset = 0; offset < entries.length; offset += limit)
        await decide(entries.slice(offset, offset + limit).map(([resource]) => resource));
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
      getLogger("RelayChannelCatalogIam", LogCategory.SECURITY).warn("Channel catalog shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
