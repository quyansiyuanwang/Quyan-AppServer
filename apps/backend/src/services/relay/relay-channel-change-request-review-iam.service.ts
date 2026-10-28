import { projectRelayChannelChangeRequest } from "./relay-channel-change-request-projection";
import { platformRelayChannelChangeRequestArn } from "@/iam/resources/relay-channel-change-request-resources";
import { isDeepStrictEqual as same } from "node:util";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import {
  platformRelayChannelArn,
  platformRelayChannelProviderArn,
} from "@/iam/resources/platform-relay-channel-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import {
  type ChangeRequestReviewPreparation,
  type ChangeRequestProviderPreparation,
  RelayChannelChangeRequestReviewRepository,
} from "@/store/relay/relay-channel-change-request-review.repository";
import { assertIamAccountPrincipal, iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { PermissionService } from "../users/permission.service";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { reviewRelayChannelChangeRequestBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import BusinessLogService from "../system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { TypedRequest } from "@/types/express";
import type { RelayChannelChangeRequestDto, ReviewRelayChannelChangeRequest } from "@/api/dto/relay/relay-channel.dto";
const action = "quyan:relay:ReviewChannelChangeRequest";
/** Review and its safe configuration response share a final authorization/transaction boundary. */
export class RelayChannelChangeRequestReviewIamService {
  private static instance: RelayChannelChangeRequestReviewIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelChangeRequestReviewIamService());
  }
  async execute(
    id: string,
    input: ReviewRelayChannelChangeRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    prepare: ChangeRequestReviewPreparation,
    prepareProvider: ChangeRequestProviderPreparation,
    legacy: () => Promise<RelayChannelChangeRequestDto>,
  ): Promise<RelayChannelChangeRequestDto> {
    const parsed = reviewRelayChannelChangeRequestBodySchema.safeParse(input);
    if (!parsed.success || !isPlatformLogResourceId(id))
      throw new BadRequestError("Invalid channel review request", undefined, { messageKey: "errors.badRequest" });
    const data = parsed.data,
      mode = env.security.iamAuthorizationMode;
    if (data.action === "reject" && !data.reason)
      throw new BadRequestError("审核说明不能为空", undefined, { messageKey: "relay.reviewReasonRequired" });
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
        await PermissionService.getInstance().checkUserPermissions(actorUserId, [Permission.RELAY_CHANNEL_REVIEW], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (persist: boolean) => {
      const iam = IamAuthorizationService.getInstance(),
        snapshots = PlatformManagementReadRepository.getInstance(),
        repository = RelayChannelChangeRequestReviewRepository.getInstance(),
        snapshot = await snapshots.snapshot(principal, Permission.RELAY_CHANNEL_REVIEW),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId),
        link = await repository.link(id),
        resources = [
          platformRelayChannelChangeRequestArn(link.relayChannelId, id),
          platformRelayChannelArn(link.relayChannelId),
        ];
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
          const group = await platformManagementGroupSnapshot(principal, Permission.RELAY_CHANNEL_REVIEW, tx),
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
        } else await snapshots.recheck(principal, Permission.RELAY_CHANNEL_REVIEW, snapshot);
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
      await recheck(); // Only narrow relation metadata is read before admitting both resources.
      const target = await repository.candidate(link);
      const targets =
        data.action === "approve" && target.row.reviewStatus === "pending"
          ? await repository.providers(target.row)
          : undefined;
      if (data.action === "approve" && target.row.reviewStatus === "pending") {
        const recipients = [
          ...new Set([
            ...target.channel.providers.map((row) => row.userId),
            ...(targets ?? []).map((row) => row.user.id),
          ]),
        ];
        resources.push(...recipients.map((userId) => platformRelayChannelProviderArn(link.relayChannelId, userId)));
      }
      await recheck(); // Authorize every added, retained and removed provider relationship.
      return repository.apply(
        target,
        data,
        targets,
        { principal, snapshot, recheck },
        persist,
        prepare,
        prepareProvider,
        projectRelayChannelChangeRequest,
      );
    };
    if (mode === "enforce") {
      const result = await native(true);
      if (!result) throw iamAccountDenied();
      await BusinessLogService.getInstance().logOperation({
        operationType: OperationType.RELAY_CHANNEL_UPDATE,
        operationCategory: OperationCategory.RELAY,
        actorUserId,
        targetResourceId: result.relayChannelId,
        targetResourceType: "RELAY_CHANNEL",
        description: "Reviewed an authorized channel change proposal",
        metadata: { action: data.action, changeRequestId: id },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });
      return result;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelChangeRequestReviewIam", LogCategory.SECURITY).warn(
        "Channel review shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}
