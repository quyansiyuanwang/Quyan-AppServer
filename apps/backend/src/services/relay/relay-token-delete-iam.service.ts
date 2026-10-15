import type { Prisma } from "@prisma/client";
import { Permission, buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { batchDeleteRelayTokensBodySchema } from "@/api/schema/relay/relay.schema";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { relayTokenArn, platformRelayTokenArn, isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { RelayTokenDeleteRepository } from "@/store/relay/relay-token-delete.repository";
import type { RelayTokenAuthorityIdentity } from "@/store/relay/relay-token-authority";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:DeleteToken",
  managedAction = "quyan:relay:DeleteManagedToken";
export class RelayTokenDeleteIamService {
  private static instance: RelayTokenDeleteIamService;
  static getInstance() {
    return (this.instance ??= new RelayTokenDeleteIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<
      RelayTokenDeleteRepository,
      "snapshot" | "tokenOwner" | "candidates" | "remove"
    > = RelayTokenDeleteRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async remove(
    actorUserId: string,
    input: { ids: string[]; targetUserId?: string },
    request: TypedRequest | undefined,
    single: boolean,
    legacy: () => Promise<{ total: number; affected: number }>,
  ): Promise<{ total: number; affected: number; userId?: string }> {
    const parsed = batchDeleteRelayTokensBodySchema.strict().safeParse(input);
    if (
      !parsed.success ||
      parsed.data.ids.some((id) => !isRelayTokenResourceId(id)) ||
      (single && parsed.data.ids.length !== 1)
    )
      throw new BadRequestError("Invalid token deletion selection", undefined, { messageKey: "errors.badRequest" });
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
        await this.permissions.checkUserPermissions(actorUserId, [Permission.RELAY_TOKEN_DELETE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (persist: boolean) => {
      await this.iam.loadPolicies(principal);
      const userId =
        parsed.data.targetUserId ?? (single ? await this.repository.tokenOwner(parsed.data.ids[0]!) : actorUserId);
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
      const recheck = async (tx?: Prisma.TransactionClient) => {
        assertRequest();
        if (
          JSON.stringify(await this.repository.snapshot(identity, tx)) !== JSON.stringify(snapshot) ||
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId, tx)) !== keyRevision
        )
          throw iamAccountDenied();
        // Async proof reads must not allow the request binding to change underneath them.
        assertRequest();
      };
      const resources = parsed.data.ids.map((id) =>
        identity.managed ? platformRelayTokenArn(userId, id) : relayTokenArn(principal.accountOwnerId, userId, id),
      );
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
        await requireAllow(identity.managed ? managedAction : action, resources);
      };
      await recheck();
      await authorize();
      const candidates = await this.repository.candidates(userId, parsed.data.ids);
      return {
        ...(await this.repository.remove(candidates, { identity, snapshot, recheck, authorize }, persist)),
        userId,
      };
    };
    if (mode === "enforce") return native(true);
    try {
      await native(false);
    } catch {
      getLogger("RelayTokenDeleteIam", LogCategory.SECURITY).warn("Token deletion shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
