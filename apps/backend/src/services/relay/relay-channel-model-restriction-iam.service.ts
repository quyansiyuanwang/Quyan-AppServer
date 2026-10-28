import { projectAuthorizedRelayChannelMutation } from "./relay-channel-authorized-mutation-projection";
import { planRelayChannelModelRestriction } from "./relay-channel-model-restriction";
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
import { RelayChannelModelRestrictionRepository } from "@/store/relay/relay-channel-model-restriction.repository";
import { assertIamAccountPrincipal, iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { PermissionService } from "../users/permission.service";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { applyRelayChannelModelRestrictionsBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import BusinessLogService from "../system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { TypedRequest } from "@/types/express";
import type {
  ApplyRelayChannelModelRestrictionsResponse,
  ApplyRelayChannelModelRestrictionsRequest,
} from "@/api/dto/relay/relay-channel.dto";
const action = "quyan:relay:ApplyChannelModelRestrictions";
/** Batch restriction writes and their safe configuration responses share a final authorization/transaction boundary. */
export class RelayChannelModelRestrictionIamService {
  private static instance: RelayChannelModelRestrictionIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelModelRestrictionIamService());
  }
  async execute(
    input: ApplyRelayChannelModelRestrictionsRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<ApplyRelayChannelModelRestrictionsResponse>,
  ): Promise<ApplyRelayChannelModelRestrictionsResponse> {
    const parsed = applyRelayChannelModelRestrictionsBodySchema.safeParse(input);
    if (!parsed.success || parsed.data.targets.some((target) => !isPlatformLogResourceId(target.channelId)))
      throw new BadRequestError("Invalid channel model restriction request", undefined, {
        messageKey: "errors.badRequest",
      });
    const data = parsed.data,
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
        await PermissionService.getInstance().checkUserPermissions(actorUserId, [Permission.RELAY_CHANNEL_UPDATE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (persist: boolean) => {
      const iam = IamAuthorizationService.getInstance(),
        snapshots = PlatformManagementReadRepository.getInstance(),
        repository = RelayChannelModelRestrictionRepository.getInstance(),
        snapshot = await snapshots.snapshot(principal, Permission.RELAY_CHANNEL_UPDATE),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId),
        resources = data.targets.map((target) => platformRelayChannelArn(target.channelId));
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
          const group = await platformManagementGroupSnapshot(principal, Permission.RELAY_CHANNEL_UPDATE, tx),
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
        } else await snapshots.recheck(principal, Permission.RELAY_CHANNEL_UPDATE, snapshot);
        if (
          fingerprintIamPolicies(await iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId, tx)) !== keyRevision
        )
          throw iamAccountDenied();
        const decisions = await platformCollectionDecisions(iam, {
          principal,
          action,
          request,
          resources,
        });
        if (decisions.length !== resources.length || decisions.some((decision) => decision !== "Allow"))
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck(); // Admit the entire batch before reading configuration or model metadata.
      const targets = await repository.candidates(data.targets.map((target) => target.channelId));
      await recheck();
      return repository.apply(
        targets,
        data,
        { principal, snapshot, recheck },
        persist,
        planRelayChannelModelRestriction,
        (tx, id) => projectAuthorizedRelayChannelMutation(tx, { principal, action, request, id, recheck }),
      );
    };
    if (mode === "enforce") {
      const result = await native(true);
      if (!result) throw iamAccountDenied();
      await BusinessLogService.getInstance().logOperation({
        operationType: OperationType.RELAY_CHANNEL_BATCH_UPDATE,
        operationCategory: OperationCategory.RELAY,
        actorUserId,
        targetResourceType: "RELAY_CHANNEL",
        description: "Applied authorized channel model restrictions",
        metadata: {
          ids: data.targets.map((target) => target.channelId),
          updated: result.updated.length,
          rejected: result.rejected.length,
        },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });
      return result;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelModelRestrictionIam", LogCategory.SECURITY).warn(
        "Channel model restriction shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}
