import type { Prisma } from "@prisma/client";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { projectRelayChannelRoutingCatalog } from "./relay-channel-routing-catalog-projection";
import type { RelayCatalogSnapshot } from "@/store/relay/relay-channel-catalog-read.repository";
import { isDeepStrictEqual as same } from "node:util";
import { Permission, iamLegacyPermissionsForAction, buildAcsResource } from "@quyan/shared";
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
    return this.readProjection(
      actorUserId,
      request,
      legacy,
      "quyan:relay:ListChannelCatalog",
      projectRelayChannelCatalog,
    );
  }
  async readRouting(
    actorUserId: string,
    targetUserId: string | undefined,
    request: TypedRequest | undefined,
    legacy: () => Promise<import("@/api/dto/relay/relay-channel.dto").RelayRoutingCatalogOptionDto[]>,
  ) {
    return this.readProjection(
      actorUserId,
      request,
      legacy,
      "quyan:relay:ListChannelRoutingCatalog",
      projectRelayChannelRoutingCatalog,
      targetUserId,
    );
  }
  private async readProjection<T>(
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<T[]>,
    action: "quyan:relay:ListChannelCatalog" | "quyan:relay:ListChannelRoutingCatalog",
    project: (snapshot: RelayCatalogSnapshot) => Promise<T[]>,
    targetUserId?: string,
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
    const targetId = targetUserId?.trim() || actorUserId,
      otherTarget = targetId !== actorUserId;
    if (!isRelayTokenResourceId(targetId)) throw iamAccountDenied();
    const evaluate = async (hydrate: boolean) => {
      const target = otherTarget
          ? await RelayChannelCatalogReadRepository.getInstance().targetMetadata(principal, targetId)
          : undefined,
        managed = Boolean(target && (target.accountOwnerId || target.id) !== principal.accountOwnerId);
      const iam = IamAuthorizationService.getInstance(),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId),
        oauth = request.oauthAccessToken
          ? { id: request.oauthAccessToken.id, clientId: request.oauthAccessToken.oauthClientId }
          : undefined,
        scopes = [Permission.RELAY_CHANNEL_READ],
        oauthRevision = await captureIamOAuthRevision(principal, oauth, scopes),
        transport = requestTransportConditionContext(request);
      const observed = new Map<string, { action: string; resource: string; decision: string }>();
      const decide = async (checkedAction: string, resources: readonly string[]) => {
        const outcomes = await platformCollectionDecisions(iam, {
          principal,
          action: checkedAction,
          request,
          resources,
        });
        resources.forEach((resource, index) => {
          const decision = outcomes[index]!;
          const key = checkedAction + "\0" + resource;
          if (observed.has(key) && observed.get(key)!.decision !== decision) throw iamAccountDenied();
          observed.set(key, { action: checkedAction, resource, decision });
        });
        return outcomes;
      };
      const previewAction = managed
          ? "quyan:relay:PreviewManagedChannelRoutingCatalog"
          : "quyan:relay:PreviewChannelRoutingCatalog",
        previewResource = managed
          ? platformUserArn(targetId)
          : buildAcsResource({
              service: "quyan",
              region: "*",
              accountId: principal.accountOwnerId,
              path: "user/" + targetId,
            }),
        managementPermission = Permission.RELAY_TOKEN_MANAGE_OTHERS_READ,
        managementGroup = managed ? await platformManagementGroupSnapshot(principal, managementPermission) : undefined;
      const admitTarget = async (tx?: Prisma.TransactionClient) => {
        if (!otherTarget) return;
        if (
          target &&
          !same(target, await RelayChannelCatalogReadRepository.getInstance().targetMetadata(principal, targetId))
        )
          throw iamAccountDenied();
        if (
          (managed &&
            !same(managementGroup, await platformManagementGroupSnapshot(principal, managementPermission, tx))) ||
          (await decide(previewAction, [previewResource])).some((result) => result !== "Allow")
        )
          throw iamAccountDenied();
      };
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
      assertRequest();
      const targetSnapshot = otherTarget
        ? await RelayChannelCatalogReadRepository.getInstance().targetSnapshot(principal, targetId, () => admitTarget())
        : undefined;
      const recheck = async () => {
        assertRequest();
        await assertIamAccountPrincipal(principal);
        if (
          fingerprintIamPolicies(await iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId)) !== keyRevision ||
          (await captureIamOAuthRevision(principal, oauth, scopes)) !== oauthRevision
        )
          throw iamAccountDenied();
        await admitTarget();
        if (
          otherTarget &&
          !same(
            targetSnapshot,
            await RelayChannelCatalogReadRepository.getInstance().targetSnapshot(principal, targetId, () =>
              admitTarget(),
            ),
          )
        )
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck();
      const result = await RelayChannelCatalogReadRepository.getInstance().read(
        principal,
        (resources) => decide(action, resources),
        recheck,
        hydrate ? project : undefined,
        otherTarget ? { userId: targetId, authorize: admitTarget } : undefined,
      );
      await recheck();
      // Time-based conditions and out-of-transaction revocation must still hold at response release.
      const entries = [...observed.values()],
        limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
      for (const checkedAction of new Set(entries.map((entry) => entry.action))) {
        const group = entries.filter((entry) => entry.action === checkedAction);
        for (let offset = 0; offset < group.length; offset += limit)
          await decide(
            checkedAction,
            group.slice(offset, offset + limit).map((entry) => entry.resource),
          );
      }
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
