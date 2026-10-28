import { isDeepStrictEqual as same } from "node:util";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { PlatformRelayChannelDeleteRepository } from "@/store/relay/platform-relay-channel-delete.repository";
import { assertIamAccountPrincipal, iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { PermissionService } from "../users/permission.service";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { batchDeleteRelayChannelsBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import BusinessLogService from "../system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { TypedRequest } from "@/types/express";
import type { BatchRelayChannelsResultDto } from "@/api/dto/relay/relay-channel.dto";
const action = "quyan:relay:DeleteChannel";
/** Deletion authority includes mandatory reference cleanup, never disclosure of the referenced credentials. */
export class PlatformRelayChannelDeleteIamService {
  private static instance: PlatformRelayChannelDeleteIamService;
  static getInstance() {
    return (this.instance ??= new PlatformRelayChannelDeleteIamService());
  }
  async execute(
    input: { ids: string[] },
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<BatchRelayChannelsResultDto>,
    single = false,
  ): Promise<BatchRelayChannelsResultDto> {
    const parsed = batchDeleteRelayChannelsBodySchema.safeParse(input);
    if (
      !parsed.success ||
      parsed.data.ids.some((id) => !isPlatformLogResourceId(id)) ||
      (single && parsed.data.ids.length !== 1)
    )
      throw new BadRequestError("Invalid channel deletion request", undefined, { messageKey: "errors.badRequest" });
    const { ids } = parsed.data,
      mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const identity = getIamPrincipal(request);
    if (
      !identity ||
      identity.subjectUserId !== actorUserId ||
      identity.principalUserId !== actorUserId ||
      request.oauthAccessToken
    )
      throw iamAccountDenied();
    const principal: IamPrincipal = { ...identity };
    if (
      mode !== "enforce" &&
      !(
        await PermissionService.getInstance().checkUserPermissions(actorUserId, [Permission.RELAY_CHANNEL_DELETE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (persist: boolean) => {
      const iam = IamAuthorizationService.getInstance(),
        snapshots = PlatformManagementReadRepository.getInstance(),
        repository = PlatformRelayChannelDeleteRepository.getInstance(),
        snapshot = await snapshots.snapshot(principal, Permission.RELAY_CHANNEL_DELETE),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId);
      const assertRequest = () => {
        if (
          env.security.iamAuthorizationMode !== mode ||
          !same(getIamPrincipal(request), principal) ||
          request.accessKey?.id !== keyId ||
          request.oauthAccessToken
        )
          throw iamAccountDenied();
      };
      const recheck = async (tx?: Prisma.TransactionClient) => {
        assertRequest();
        if (tx) {
          await assertIamAccountPrincipal(principal, tx);
          const group = await platformManagementGroupSnapshot(principal, Permission.RELAY_CHANNEL_DELETE, tx),
            users = await tx.user.findMany({
              where: { id: { in: snapshot.users.map((row) => row.id) }, status: 1 },
              select: { id: true, updateTime: true },
              orderBy: { id: "asc" },
            });
          if (
            !same(group, snapshot.group) ||
            !same(
              users,
              [...snapshot.users].sort((a, b) => a.id.localeCompare(b.id)),
            )
          )
            throw iamAccountDenied();
        } else await snapshots.recheck(principal, Permission.RELAY_CHANNEL_DELETE, snapshot);
        if (
          fingerprintIamPolicies(await iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId, tx)) !== keyRevision
        )
          throw iamAccountDenied();
        const decisions = await platformCollectionDecisions(iam, {
          principal,
          action,
          request,
          resources: ids.map(platformRelayChannelArn),
        });
        if (decisions.length !== ids.length || decisions.some((decision) => decision !== "Allow"))
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck(); // No channel or binding lookup before every requested resource is admitted.
      const targets = await repository.candidates(ids);
      await recheck();
      return repository.apply(targets, { principal, snapshot, recheck }, persist);
    };
    if (mode === "enforce") {
      const result = await native(true);
      await BusinessLogService.getInstance().logOperation({
        operationType: single ? OperationType.RELAY_CHANNEL_DELETE : OperationType.RELAY_CHANNEL_BATCH_DELETE,
        operationCategory: OperationCategory.RELAY,
        actorUserId,
        targetResourceId: single ? ids[0] : undefined,
        targetResourceType: "RELAY_CHANNEL",
        description: "Deleted authorized relay channels and cleared routing references",
        metadata: { ids, total: result.total, affected: result.affected },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });
      return result;
    }
    try {
      await native(false);
    } catch {
      getLogger("PlatformRelayChannelDeleteIam", LogCategory.SECURITY).warn(
        "Channel deletion shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}
