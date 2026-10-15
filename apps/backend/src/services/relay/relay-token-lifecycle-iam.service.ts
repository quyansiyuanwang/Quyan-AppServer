import type { Prisma } from "@prisma/client";
import { Permission, buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { relayTokenArn, platformRelayTokenArn, isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { RelayTokenMutationRepository } from "@/store/relay/relay-token-mutation.repository";
import { RelayTokenMutationResponseRepository } from "@/store/relay/relay-token-mutation-response.repository";
import { captureRelayTokenAuthority, RELAY_TOKEN_AUTHORITY_REQUIREMENTS } from "@/store/relay/relay-token-authority";
import type { RelayTokenReadRecord } from "@/store/relay/relay-token-read.repository";
import type { RelayTokenAuthorityIdentity } from "@/store/relay/relay-token-authority";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const operations = Object.freeze({
  toggle: { action: "quyan:relay:SetTokenStatus", managedAction: "quyan:relay:SetManagedTokenStatus" },
  refresh: { action: "quyan:relay:RefreshToken", managedAction: "quyan:relay:RefreshManagedToken" },
});
export class RelayTokenLifecycleIamService {
  private static instance: RelayTokenLifecycleIamService;
  static getInstance() {
    return (this.instance ??= new RelayTokenLifecycleIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository = RelayTokenMutationRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly responses = RelayTokenMutationResponseRepository.getInstance(),
  ) {}
  async execute<T>(
    operation: keyof typeof operations,
    actorUserId: string,
    tokenId: string,
    targetUserId: string | undefined,
    request: TypedRequest | undefined,
    project: (record: RelayTokenReadRecord) => Promise<T>,
    legacy: () => Promise<T>,
  ): Promise<T> {
    if (!isRelayTokenResourceId(tokenId) || (targetUserId !== undefined && !isRelayTokenResourceId(targetUserId)))
      throw new BadRequestError("Invalid token lifecycle target", undefined, { messageKey: "errors.badRequest" });
    const { action, managedAction } = operations[operation];
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const current = getIamPrincipal(request);
    if (!current || current.subjectUserId !== actorUserId || current.principalUserId !== actorUserId)
      throw iamAccountDenied();
    const principal: IamPrincipal = { ...current };
    if (
      mode !== "enforce" &&
      !(
        await this.permissions.checkUserPermissions(actorUserId, [Permission.RELAY_TOKEN_UPDATE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (persist: boolean) => {
      await this.iam.loadPolicies(principal);
      const userId = targetUserId ?? (await this.repository.tokenOwner(tokenId));
      const oauth = request.oauthAccessToken;
      if (oauth && oauth.userId !== actorUserId) throw iamAccountDenied();
      const identity: RelayTokenAuthorityIdentity = {
        principal,
        userId,
        managed: userId !== actorUserId,
        ...(oauth ? { oauth: { id: oauth.id, clientId: oauth.oauthClientId } } : {}),
      };
      const readSnapshot = await captureRelayTokenAuthority(identity, RELAY_TOKEN_AUTHORITY_REQUIREMENTS.read);
      const snapshot = await this.repository.snapshot(identity, operation),
        fingerprint = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId);
      const assertRequest = () => {
        if (
          JSON.stringify(getIamPrincipal(request)) !== JSON.stringify(principal) ||
          request.accessKey?.id !== keyId ||
          (identity.oauth
            ? request.oauthAccessToken?.id !== identity.oauth.id ||
              request.oauthAccessToken.oauthClientId !== identity.oauth.clientId ||
              request.oauthAccessToken.userId !== actorUserId
            : Boolean(request.oauthAccessToken))
        )
          throw iamAccountDenied();
      };
      let verifyResponse: ((tx: Prisma.TransactionClient) => Promise<void>) | undefined;
      const recheck = async (tx?: Prisma.TransactionClient) => {
        assertRequest();
        if (
          JSON.stringify(await this.repository.snapshot(identity, operation, tx)) !== JSON.stringify(snapshot) ||
          JSON.stringify(await captureRelayTokenAuthority(identity, RELAY_TOKEN_AUTHORITY_REQUIREMENTS.read, tx)) !==
            JSON.stringify(readSnapshot) ||
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId, tx)) !== keyRevision
        )
          throw iamAccountDenied();
        if (tx && verifyResponse) await verifyResponse(tx);
        // Async proof reads must not allow the request binding to change underneath them.
        assertRequest();
      };
      const resource = identity.managed
        ? platformRelayTokenArn(userId, tokenId)
        : relayTokenArn(principal.accountOwnerId, userId, tokenId);
      const readAction = identity.managed ? "quyan:relay:GetManagedToken" : "quyan:relay:GetToken";
      const revealAction = identity.managed ? "quyan:relay:RevealManagedToken" : "quyan:relay:RevealToken";
      const evaluations = new Map<
        string,
        { action: string; resources: readonly string[]; decisions: readonly string[] }
      >();
      const decide = async (operation: string, targets: readonly string[]) => {
        const decisions = await platformCollectionDecisions(this.iam, {
          principal,
          action: operation,
          request,
          resources: targets,
        });
        const key = JSON.stringify([operation, targets]),
          previous = evaluations.get(key);
        if (previous && decisions.some((value, i) => value !== previous.decisions[i])) throw iamAccountDenied();
        evaluations.set(key, { action: operation, resources: targets, decisions });
        return decisions;
      };
      const requireAllow = async (operation: string, targets: readonly string[]) => {
        const results = await decide(operation, targets);
        if (results.some((result) => result !== "Allow")) throw iamAccountDenied();
      };
      const authorize = async () => {
        if (identity.managed) {
          await requireAllow(action, [
            buildAcsResource({
              service: "quyan",
              region: "*",
              accountId: principal.accountOwnerId,
              path: "user/" + actorUserId,
            }),
          ]);
          await requireAllow(managedAction, [platformUserArn(userId)]);
        }
        await requireAllow(identity.managed ? managedAction : action, [resource]);
        if (identity.managed) {
          await requireAllow("quyan:relay:GetToken", [
            buildAcsResource({
              service: "quyan",
              region: "*",
              accountId: principal.accountOwnerId,
              path: "user/" + actorUserId,
            }),
          ]);
          await requireAllow(readAction, [platformUserArn(userId)]);
        }
        await requireAllow(readAction, [resource]);
        if (operation === "refresh") await requireAllow(revealAction, [resource]);
        for (const entry of [...evaluations.values()]) await decide(entry.action, entry.resources);
      };
      await recheck();
      await authorize();
      const canReveal = (await decide(revealAction, [resource]))[0] === "Allow";
      const candidates = await this.repository.candidates(userId, [tokenId]);
      const result = await this.repository.apply(
        candidates,
        { identity, snapshot, recheck, authorize },
        { kind: operation },
        persist,
        async (tx) => {
          await recheck(tx);
          await authorize();
          const response = await this.responses.read(tx, identity, tokenId, decide, canReveal);
          verifyResponse = (tx) => this.responses.verify(tx, identity, response.targets);
          const projected = await project(response.record);
          await recheck(tx);
          await authorize();
          return projected;
        },
      );
      return result;
    };
    if (mode === "enforce") {
      const result = await native(true);
      if (!Object.prototype.hasOwnProperty.call(result, "response")) throw iamAccountDenied();
      return result.response!;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayTokenLifecycleIam", LogCategory.SECURITY).warn("Token lifecycle shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
