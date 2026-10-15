import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { Permission, buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import {
  RelayTokenReadRepository,
  type RelayTokenReadIdentity,
  type RelayTokenReadRecord,
} from "@/store/relay/relay-token-read.repository";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { exportRelayTokensBodySchema, relayTokenListQuerySchema } from "@/api/schema/relay/relay.schema";
import {
  isRelayTokenResourceId,
  relayTokenReadAction,
  type RelayTokenReadOperation,
} from "@/iam/resources/relay-token-resources";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export class RelayTokenReadIamService {
  private static instance: RelayTokenReadIamService;
  static getInstance() {
    return (this.instance ??= new RelayTokenReadIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository = RelayTokenReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async read<T>(
    operation: RelayTokenReadOperation,
    actorUserId: string,
    input: {
      page?: number;
      pageSize?: number;
      targetUserId?: string;
      id?: string;
      ids?: string[];
      includeDisabled?: boolean;
    },
    request: TypedRequest | undefined,
    project: (records: RelayTokenReadRecord[]) => Promise<T[]>,
    legacy: () => Promise<{ items: T[]; total: number; page: number; pageSize: number }>,
  ) {
    const { id, ...filters } = input,
      parsed =
        operation === "ExportTokens"
          ? exportRelayTokensBodySchema.strict().safeParse(filters)
          : relayTokenListQuerySchema.strict().safeParse(filters);
    if (!parsed.success || (operation === "GetToken" && !isRelayTokenResourceId(id)))
      throw new BadRequestError("Invalid relay token query", undefined, { messageKey: "errors.badRequest" });
    if (
      operation === "ExportTokens" &&
      (id !== undefined || ("ids" in parsed.data && parsed.data.ids?.some((value) => !isRelayTokenResourceId(value))))
    )
      throw new BadRequestError("Invalid relay token export", undefined, { messageKey: "errors.badRequest" });
    const query = {
        page: "page" in parsed.data ? (parsed.data.page ?? 1) : 1,
        pageSize: "pageSize" in parsed.data ? (parsed.data.pageSize ?? 20) : 20,
        id,
        ...(operation === "ExportTokens"
          ? {
              ids: "ids" in parsed.data ? parsed.data.ids : undefined,
              includeDisabled: "includeDisabled" in parsed.data && parsed.data.includeDisabled === true,
            }
          : {}),
      },
      mode = env.security.iamAuthorizationMode;
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
    const native = async (hydrate: boolean) => {
      await this.iam.loadPolicies(principal);
      const userId = parsed.data.targetUserId ?? (id ? await this.repository.tokenOwner(id) : actorUserId);
      const identity: RelayTokenReadIdentity = {
        principal,
        userId,
        managed: userId !== actorUserId,
        ...(request.oauthAccessToken
          ? { oauth: { id: request.oauthAccessToken.id, clientId: request.oauthAccessToken.oauthClientId } }
          : {}),
      };
      if (request.oauthAccessToken?.userId && request.oauthAccessToken.userId !== actorUserId) throw iamAccountDenied();
      const snapshot = await this.repository.snapshot(identity),
        fingerprint = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId);
      const recheck = async () => {
        const actual = getIamPrincipal(request);
        if (
          JSON.stringify(actual) !== JSON.stringify(principal) ||
          request.accessKey?.id !== keyId ||
          (identity.oauth
            ? request.oauthAccessToken?.id !== identity.oauth.id ||
              request.oauthAccessToken.oauthClientId !== identity.oauth.clientId ||
              request.oauthAccessToken.userId !== actorUserId
            : Boolean(request.oauthAccessToken))
        )
          throw iamAccountDenied();
        await this.repository.recheck(identity, snapshot);
        if (
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId)) !== keyRevision
        )
          throw iamAccountDenied();
      };
      const decide = (action: string, resources: readonly string[]) =>
        platformCollectionDecisions(this.iam, { action, principal, request, resources });
      const admission = async () => {
        if (!identity.managed) return;
        // The personal endpoint grant does not grant platform access. Management requires both boundaries.
        const userArn = buildAcsResource({
          service: "quyan",
          region: "*",
          accountId: principal.accountOwnerId,
          path: "user/" + actorUserId,
        });
        if (
          (await decide("quyan:relay:" + operation, [userArn]))[0] !== "Allow" ||
          (await decide(relayTokenReadAction(operation, true), [platformUserArn(userId)]))[0] !== "Allow"
        )
          throw iamAccountDenied();
      };
      await recheck();
      await admission();
      const result = await this.repository.read(identity, snapshot, operation, query, decide, recheck, hydrate);
      const items = hydrate ? await project(result.records) : [];
      await recheck();
      await admission();
      // Projection may query quota usage. Re-evaluate every contributing decision after it,
      // including reveal grants; a second list must not silently replace the original proof.
      for (const checkedAction of new Set(result.evaluations.map((value) => value.action))) {
        const entries = result.evaluations.filter((value) => value.action === checkedAction);
        for (let offset = 0; offset < entries.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
          const batch = entries.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
          const outcomes = await decide(
            checkedAction,
            batch.map((value) => value.resource),
          );
          if (outcomes.length !== batch.length || outcomes.some((value, index) => value !== batch[index]!.decision))
            throw iamAccountDenied();
        }
      }
      await this.repository.assertTargets(identity, result.targets);
      await recheck();
      return { items, total: result.total, page: result.page, pageSize: result.pageSize };
    };
    if (mode === "enforce") return native(true);
    try {
      await native(false);
    } catch {
      getLogger("RelayTokenReadIam", LogCategory.SECURITY).warn("Relay token read shadow evaluation failed", {
        action: "quyan:relay:" + operation,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
