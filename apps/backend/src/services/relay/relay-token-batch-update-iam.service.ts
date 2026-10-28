import type { Prisma } from "@prisma/client";
import { Permission, buildAcsResource, type IamPrincipal } from "@quyan/shared";
import type { ContentSafetyPolicyOverride } from "@quyan/shared";
import { ContentSafetyService } from "@/services/system/content-safety.service";
import { env } from "@/config/env";
import {
  batchSetRelayTokenStatusBodySchema,
  batchRelayTokenContentSafetyBodySchema,
} from "@/api/schema/relay/relay.schema";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { relayTokenArn, platformRelayTokenArn, isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { RelayTokenMutationRepository } from "@/store/relay/relay-token-mutation.repository";
import type { RelayTokenAuthorityIdentity } from "@/store/relay/relay-token-authority";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const operations = Object.freeze({
  status: { action: "quyan:relay:SetTokenStatus", managedAction: "quyan:relay:SetManagedTokenStatus" },
  "content-safety": {
    action: "quyan:relay:SetTokenContentSafety",
    managedAction: "quyan:relay:SetManagedTokenContentSafety",
  },
});
export class RelayTokenBatchUpdateIamService {
  private static instance: RelayTokenBatchUpdateIamService;
  static getInstance() {
    return (this.instance ??= new RelayTokenBatchUpdateIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository = RelayTokenMutationRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly safety: Pick<ContentSafetyService, "getEffectivePolicy"> = ContentSafetyService.getInstance(),
  ) {}
  async setStatus(
    actorUserId: string,
    input: { ids: string[]; enabled: boolean; targetUserId?: string },
    request: TypedRequest | undefined,
    legacy: () => Promise<{ total: number; affected: number }>,
  ) {
    const parsed = batchSetRelayTokenStatusBodySchema.strict().safeParse(input);
    if (!parsed.success || typeof input.enabled !== "boolean")
      throw new BadRequestError("Invalid token status selection", undefined, { messageKey: "errors.badRequest" });
    return this.execute(actorUserId, parsed.data, request, "status", { enabled: parsed.data.enabled }, legacy);
  }
  async setContentSafety(
    actorUserId: string,
    input: { ids: string[]; mode: "snapshot" | "clear"; targetUserId?: string },
    request: TypedRequest | undefined,
    legacy: () => Promise<{ total: number; affected: number }>,
  ) {
    const parsed = batchRelayTokenContentSafetyBodySchema.strict().safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid token safety selection", undefined, { messageKey: "errors.badRequest" });
    return this.execute(actorUserId, parsed.data, request, "content-safety", { mode: parsed.data.mode }, legacy);
  }
  private async execute(
    actorUserId: string,
    input: { ids: string[]; targetUserId?: string },
    request: TypedRequest | undefined,
    operation: keyof typeof operations,
    settings: { enabled: boolean } | { mode: "snapshot" | "clear" },
    legacy: () => Promise<{ total: number; affected: number }>,
  ): Promise<{ total: number; affected: number; userId?: string }> {
    if (input.ids.some((id) => !isRelayTokenResourceId(id)))
      throw new BadRequestError("Invalid token update selection", undefined, { messageKey: "errors.badRequest" });
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
      const userId = input.targetUserId ?? actorUserId;
      const oauth = request.oauthAccessToken;
      if (oauth && oauth.userId !== actorUserId) throw iamAccountDenied();
      const identity: RelayTokenAuthorityIdentity = {
        principal,
        userId,
        managed: userId !== actorUserId,
        ...(oauth ? { oauth: { id: oauth.id, clientId: oauth.oauthClientId } } : {}),
      };
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
      const recheck = async (tx?: Prisma.TransactionClient) => {
        assertRequest();
        if (
          JSON.stringify(await this.repository.snapshot(identity, operation, tx)) !== JSON.stringify(snapshot) ||
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId, tx)) !== keyRevision
        )
          throw iamAccountDenied();
        // Async proof reads must not allow the request binding to change underneath them.
        assertRequest();
      };
      const resources = input.ids.map((id) =>
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
      const candidates = await this.repository.candidates(userId, input.ids);
      return {
        ...(await this.repository.apply(
          candidates,
          { identity, snapshot, recheck, authorize },
          "enabled" in settings
            ? { kind: "status", enabled: settings.enabled }
            : {
                kind: "content-safety",
                config:
                  settings.mode === "clear"
                    ? null
                    : ((await this.safety.getEffectivePolicy(userId, null)) as ContentSafetyPolicyOverride),
              },
          persist,
        )),
        userId,
      };
    };
    if (mode === "enforce") return native(true);
    try {
      await native(false);
    } catch {
      getLogger("RelayTokenBatchUpdateIam", LogCategory.SECURITY).warn("Token batch update shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
