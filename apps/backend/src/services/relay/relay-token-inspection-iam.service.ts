import { relayTokenIdsSchema } from "@/api/schema/relay/relay.schema";
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
type Selection =
  | { kind: "usage" | "switch-logs"; id: string }
  | { kind: "usage-batch" | "composition-candidates"; ids?: string[] };
const inspectionActions = Object.freeze({
  "composition-candidates": {
    action: "quyan:relay:ListTokenCompositionCandidates",
    managedAction: "quyan:relay:ListManagedTokenCompositionCandidates",
  },
  usage: { action: "quyan:relay:GetTokenUsage", managedAction: "quyan:relay:GetManagedTokenUsage" },
  "usage-batch": { action: "quyan:relay:GetTokenUsage", managedAction: "quyan:relay:GetManagedTokenUsage" },
  "switch-logs": { action: "quyan:relay:GetTokenSwitchLogs", managedAction: "quyan:relay:GetManagedTokenSwitchLogs" },
});
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
    return this.inspect(
      { kind: "usage", id: tokenId },
      actorUserId,
      targetUserId,
      request,
      (targets) => read(targets[0]!),
      legacy,
    );
  }
  async summaries<T>(
    actorUserId: string,
    ids: string[] | undefined,
    targetUserId: string | undefined,
    request: TypedRequest | undefined,
    read: (targets: RelayTokenInspectionTarget[]) => Promise<T>,
    legacy: () => Promise<T>,
  ) {
    const parsed = ids === undefined ? undefined : relayTokenIdsSchema.safeParse(ids);
    if (parsed && !parsed.success)
      throw new BadRequestError("Invalid token usage selection", undefined, { messageKey: "errors.badRequest" });
    return this.inspect(
      { kind: "usage-batch", ids: parsed?.success ? parsed.data : undefined },
      actorUserId,
      targetUserId,
      request,
      (targets) => read(targets),
      legacy,
    );
  }
  async switchLogs<T>(
    actorUserId: string,
    id: string,
    targetUserId: string | undefined,
    request: TypedRequest | undefined,
    read: (target: RelayTokenInspectionTarget) => Promise<T>,
    legacy: () => Promise<T>,
  ) {
    return this.inspect(
      { kind: "switch-logs", id },
      actorUserId,
      targetUserId,
      request,
      (targets) => read(targets[0]!),
      legacy,
    );
  }
  async candidates<T>(
    actorUserId: string,
    targetUserId: string | undefined,
    request: TypedRequest | undefined,
    read: (targets: RelayTokenInspectionTarget[], userId: string) => Promise<T>,
    legacy: () => Promise<T>,
  ) {
    return this.inspect({ kind: "composition-candidates" }, actorUserId, targetUserId, request, read, legacy);
  }
  private async inspect<T>(
    selection: Selection,
    actorUserId: string,
    targetUserId: string | undefined,
    request: TypedRequest | undefined,
    read: (targets: RelayTokenInspectionTarget[], userId: string) => Promise<T>,
    legacy: () => Promise<T>,
  ): Promise<T> {
    if (
      ("id" in selection && !isRelayTokenResourceId(selection.id)) ||
      ("ids" in selection && selection.ids?.some((id) => !isRelayTokenResourceId(id))) ||
      (targetUserId !== undefined && !isRelayTokenResourceId(targetUserId))
    )
      throw new BadRequestError("Invalid token inspection selection", undefined, { messageKey: "errors.badRequest" });
    const { action, managedAction } = inspectionActions[selection.kind];
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
    const native = async <U>(
      inspect: (targets: RelayTokenInspectionTarget[], userId: string) => Promise<U>,
    ): Promise<U> => {
      await this.iam.loadPolicies(principal);
      const userId = targetUserId ?? ("id" in selection ? await this.repository.tokenOwner(selection.id) : actorUserId);
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
      const resource = (id: string) =>
        identity.managed ? platformRelayTokenArn(userId, id) : relayTokenArn(principal.accountOwnerId, userId, id);
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
        if ((await decide(operation, targets)).some((result) => result !== "Allow")) throw iamAccountDenied();
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
        if ("id" in selection) await requireAllow(identity.managed ? managedAction : action, [resource(selection.id)]);
        for (const entry of [...evaluations.values()]) await decide(entry.action, entry.resources);
      };
      await recheck();
      await authorize();
      const targets =
        "id" in selection
          ? [await this.repository.target(userId, selection.id)]
          : await this.repository.list(
              userId,
              selection.ids,
              (ids) => decide(identity.managed ? managedAction : action, ids.map(resource)),
              recheck,
            );
      const result = await inspect(targets, userId);
      // Never release a projection authorized by a stale policy, owner or credential proof.
      if ("id" in selection) await this.repository.assertTarget(targets[0]!);
      else await this.repository.assertTargets(targets);
      await recheck();
      await authorize();
      await recheck();
      return result;
    };
    if (mode === "enforce") return native(read);
    try {
      await native(async () => undefined);
    } catch {
      getLogger("RelayTokenInspectionIam", LogCategory.SECURITY).warn("Token inspection shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
