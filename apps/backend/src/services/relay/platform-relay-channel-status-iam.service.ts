import { isDeepStrictEqual as same } from "node:util";
import { projectAuthorizedRelayChannelMutation } from "./relay-channel-authorized-mutation-projection";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { PlatformRelayChannelStatusRepository } from "@/store/relay/platform-relay-channel-status.repository";
import { assertIamAccountPrincipal, iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { captureIamOAuthRevision } from "@/store/users/iam-oauth-authority";
import { PermissionService } from "@/services/users/permission.service";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { batchSetRelayChannelStatusBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type {
  BatchSetRelayChannelStatusRequest,
  BatchRelayChannelsResultDto,
  RelayChannelDto,
} from "@/api/dto/relay/relay-channel.dto";
const action = "quyan:relay:SetChannelStatus";
export class PlatformRelayChannelStatusIamService {
  private static instance: PlatformRelayChannelStatusIamService;
  static getInstance() {
    return (this.instance ??= new PlatformRelayChannelStatusIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository = PlatformRelayChannelStatusRepository.getInstance(),
    private readonly snapshots = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async execute(
    input: BatchSetRelayChannelStatusRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<BatchRelayChannelsResultDto>,
  ): Promise<BatchRelayChannelsResultDto> {
    const parsed = batchSetRelayChannelStatusBodySchema.safeParse(input);
    if (!parsed.success || parsed.data.ids.some((id) => !isPlatformLogResourceId(id)))
      throw new BadRequestError("Invalid channel status request", undefined, { messageKey: "errors.badRequest" });
    const { ids, enabled } = parsed.data;
    return this.executeAuthorized(ids, enabled, actorUserId, request, legacy, ({ total, affected }) => ({
      total,
      affected,
    }));
  }
  async toggle(
    id: string,
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayChannelDto>,
  ): Promise<RelayChannelDto> {
    if (!isPlatformLogResourceId(id))
      throw new BadRequestError("Invalid channel status target", undefined, { messageKey: "errors.badRequest" });
    if (request?.oauthAccessToken) throw iamAccountDenied(); // Unscoped JWT route does not admit OAuth.
    return this.executeAuthorized<RelayChannelDto>(
      [id],
      "toggle",
      actorUserId,
      request,
      legacy,
      (result) => {
        if (!result.value) throw iamAccountDenied();
        return result.value;
      },
      (tx, principal, request, recheck) =>
        projectAuthorizedRelayChannelMutation(tx, { principal, action, request, id, recheck }),
    );
  }
  private async executeAuthorized<T>(
    ids: string[],
    enabled: boolean | "toggle",
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<T>,
    complete: (result: { total: number; affected: number; value?: T }) => T,
    project?: (
      tx: Prisma.TransactionClient,
      principal: IamPrincipal,
      request: TypedRequest,
      recheck: (tx?: Prisma.TransactionClient) => Promise<void>,
    ) => Promise<{ value: T; verify: () => Promise<void> }>,
  ): Promise<T> {
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
        await this.permissions.checkUserPermissions(actorUserId, [Permission.RELAY_CHANNEL_UPDATE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (persist: boolean) => {
      const snapshot = await this.snapshots.snapshot(principal, Permission.RELAY_CHANNEL_UPDATE),
        fingerprint = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const oauth = request.oauthAccessToken;
      if (oauth && oauth.userId !== actorUserId) throw iamAccountDenied();
      const binding = oauth ? { id: oauth.id, clientId: oauth.oauthClientId } : undefined;
      const keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId),
        oauthRevision = await captureIamOAuthRevision(principal, binding, [Permission.RELAY_CHANNEL_UPDATE]);
      const assertRequest = () => {
        if (
          env.security.iamAuthorizationMode !== mode ||
          !same(getIamPrincipal(request), principal) ||
          request.accessKey?.id !== keyId ||
          (binding
            ? request.oauthAccessToken?.id !== binding.id ||
              request.oauthAccessToken.oauthClientId !== binding.clientId ||
              request.oauthAccessToken.userId !== actorUserId
            : Boolean(request.oauthAccessToken))
        )
          throw iamAccountDenied();
      };
      const recheck = async (tx?: Prisma.TransactionClient) => {
        assertRequest();
        if (tx) {
          await assertIamAccountPrincipal(principal, tx);
          const group = await platformManagementGroupSnapshot(principal, Permission.RELAY_CHANNEL_UPDATE, tx);
          const users = await tx.user.findMany({
            where: { id: { in: snapshot.users.map((row) => row.id) }, status: 1 },
            select: { id: true, updateTime: true },
          });
          if (
            !same(group, snapshot.group) ||
            users.length !== snapshot.users.length ||
            users.some(
              (row) =>
                !snapshot.users.some(
                  (old) => old.id === row.id && old.updateTime.getTime() === row.updateTime.getTime(),
                ),
            )
          )
            throw iamAccountDenied();
        } else await this.snapshots.recheck(principal, Permission.RELAY_CHANNEL_UPDATE, snapshot);
        if (
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId, tx)) !== keyRevision ||
          (await captureIamOAuthRevision(principal, binding, [Permission.RELAY_CHANNEL_UPDATE], tx)) !== oauthRevision
        )
          throw iamAccountDenied();
        const decisions = await platformCollectionDecisions(this.iam, {
          principal,
          action,
          request,
          resources: ids.map(platformRelayChannelArn),
        });
        if (decisions.length !== ids.length || decisions.some((decision) => decision !== "Allow"))
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck();
      const targets = await this.repository.candidates(ids);
      await recheck();
      return this.repository.apply<T>(
        targets,
        enabled,
        { principal, snapshot, recheck },
        persist,
        project ? (tx) => project(tx, principal, request, recheck) : undefined,
      );
    };
    if (mode === "enforce") return complete(await native(true));
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelStatusIam", LogCategory.SECURITY).warn("Channel status shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
