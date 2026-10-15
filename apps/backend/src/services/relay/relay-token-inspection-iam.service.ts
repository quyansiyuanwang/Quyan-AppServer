import { Permission, buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { relayTokenArn, platformRelayTokenArn, isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import {
  RelayTokenInspectionRepository,
  type RelayTokenInspectionTarget,
} from "@/store/relay/relay-token-inspection.repository";
import type { RelayTokenAuthorityIdentity } from "@/store/relay/relay-token-authority";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:GetTokenUsage",
  managedAction = "quyan:relay:GetManagedTokenUsage";
export class RelayTokenInspectionIamService {
  private static instance: RelayTokenInspectionIamService;
  static getInstance() {
    return (this.instance ??= new RelayTokenInspectionIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository = RelayTokenInspectionRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async usage<T>(
    actorUserId: string,
    tokenId: string,
    targetUserId: string | undefined,
    request: TypedRequest | undefined,
    read: (target: RelayTokenInspectionTarget) => Promise<T>,
    legacy: () => Promise<T>,
  ): Promise<T> {
    if (!isRelayTokenResourceId(tokenId) || (targetUserId !== undefined && !isRelayTokenResourceId(targetUserId)))
      throw new BadRequestError("Invalid token usage selection", undefined, { messageKey: "errors.badRequest" });
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
        await this.permissions.checkUserPermissions(actorUserId, [Permission.RELAY_TOKEN_READ], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async <U>(inspect: (target: RelayTokenInspectionTarget) => Promise<U>): Promise<U> => {
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
      const snapshot = await this.repository.snapshot(identity),
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
      const recheck = async () => {
        assertRequest();
        if (
          JSON.stringify(await this.repository.snapshot(identity)) !== JSON.stringify(snapshot) ||
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId)) !== keyRevision
        )
          throw iamAccountDenied();
        // Async proof reads must not allow the request binding to change underneath them.
        assertRequest();
      };
      const resource = identity.managed
        ? platformRelayTokenArn(userId, tokenId)
        : relayTokenArn(principal.accountOwnerId, userId, tokenId);
      const requireAllow = async (operation: string, targets: readonly string[]) => {
        const results = await platformCollectionDecisions(this.iam, {
          principal,
          action: operation,
          request,
          resources: targets,
        });
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
      };
      await recheck();
      await authorize();
      const target = await this.repository.target(userId, tokenId);
      const result = await inspect(target);
      // Never release a projection authorized by a stale policy, owner or credential proof.
      await this.repository.assertTarget(target);
      await recheck();
      await authorize();
      await recheck();
      return result;
    };
    if (mode === "enforce") return native(read);
    try {
      await native(async () => undefined);
    } catch {
      getLogger("RelayTokenInspectionIam", LogCategory.SECURITY).warn("Token usage shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
