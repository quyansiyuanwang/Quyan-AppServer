import { isDeepStrictEqual as same } from "node:util";
import { createId } from "@paralleldrive/cuid2";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import {
  relayChannelSubmissionArn,
  relayChannelSubmissionProviderArn,
} from "@/iam/resources/relay-channel-submission-resources";
import { relayChannelChangeRequestArn } from "@/iam/resources/relay-channel-change-request-resources";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import {
  assertIamAccountPrincipal,
  IamAccountUserRepository,
  iamAccountDenied,
} from "@/store/users/iam-account-principal";
import {
  RelayChannelChangeRequestCreateRepository,
  type ChangeRequestPreparation,
} from "@/store/relay/relay-channel-change-request-create.repository";
import { createRelayChannelChangeRequestBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PermissionService } from "../users/permission.service";
import BusinessLogService from "../system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { projectRelayChannelChangeRequest } from "./relay-channel-change-request-projection";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { RelayChannelChangeRequestDto, CreateRelayChannelChangeRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:CreateMyChannelChangeRequest";
export class RelayChannelChangeRequestCreateIamService {
  private static instance: RelayChannelChangeRequestCreateIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelChangeRequestCreateIamService());
  }
  async execute(
    channelId: string,
    input: CreateRelayChannelChangeRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    prepare: ChangeRequestPreparation,
    legacy: () => Promise<RelayChannelChangeRequestDto>,
  ): Promise<RelayChannelChangeRequestDto> {
    if (!isRelayTokenResourceId(channelId))
      throw new BadRequestError("Invalid channel change request", undefined, { messageKey: "errors.badRequest" });
    const mode = env.security.iamAuthorizationMode;
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
    if (![principal.accountOwnerId, principal.subjectUserId].every(isRelayTokenResourceId)) throw iamAccountDenied();
    if (
      mode !== "enforce" &&
      !(
        await PermissionService.getInstance().checkUserPermissions(actorUserId, [Permission.RELAY_CHANNEL_SUBMIT], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const parsed = createRelayChannelChangeRequestBodySchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid channel change request", undefined, { messageKey: "errors.badRequest" });
    const data = parsed.data,
      id = createId();
    if (!isRelayTokenResourceId(id)) throw iamAccountDenied();
    const native = async (persist: boolean) => {
      const iam = IamAuthorizationService.getInstance(),
        repository = RelayChannelChangeRequestCreateRepository.getInstance();
      const keyId = request.accessKey?.id,
        resources = [
          relayChannelSubmissionArn(principal.accountOwnerId, principal.subjectUserId, channelId),
          relayChannelChangeRequestArn(principal.accountOwnerId, principal.subjectUserId, id),
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
      const snapshot = async (tx?: Prisma.TransactionClient) => {
        assertRequest();
        await assertIamAccountPrincipal(principal, tx);
        const ids = [...new Set([principal.subjectUserId, principal.accountOwnerId])].sort();
        const users = tx
          ? await tx.user.findMany({ where: { id: { in: ids }, status: 1 }, select: { id: true, updateTime: true } })
          : await IamAccountUserRepository.getInstance().targets(principal, ids);
        if (users.length !== ids.length || ids.some((id) => !users.some((user) => user.id === id)))
          throw iamAccountDenied();
        return users.sort((a, b) => a.id.localeCompare(b.id));
      };
      const users = await snapshot(),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyRevision = await captureIamAccessKeyRevision(principal, keyId);
      const recheck = async (tx?: Prisma.TransactionClient) => {
        if (
          !same(await snapshot(tx), users) ||
          fingerprintIamPolicies(await iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId, tx)) !== keyRevision
        )
          throw iamAccountDenied();
        const decisions = await platformCollectionDecisions(iam, { principal, action, request, resources });
        if (decisions.length !== resources.length || decisions.some((decision) => decision !== "Allow"))
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck(); // Admit the owned channel and reserved proposal before metadata/user lookups.
      const target = await repository.candidate(principal, channelId);
      resources.push(
        ...target.pending.map((row) =>
          relayChannelChangeRequestArn(principal.accountOwnerId, principal.subjectUserId, row.id),
        ),
      );
      await recheck(); // Replacing every pending proposal requires its own grant.
      const targets = await repository.providers(data);
      if (targets?.some((target) => !isRelayTokenResourceId(target.user.id))) throw iamAccountDenied();
      resources.push(
        ...(targets ?? []).map((target) =>
          relayChannelSubmissionProviderArn(
            principal.accountOwnerId,
            principal.subjectUserId,
            channelId,
            target.user.id,
          ),
        ),
      );
      await recheck();
      return repository.create(
        id,
        target,
        data,
        targets,
        { principal, users, recheck },
        prepare,
        persist,
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
        targetResourceId: channelId,
        targetResourceType: "RELAY_CHANNEL",
        description: "Created an authorized owned channel change proposal",
        metadata: { changeRequestId: id, providerCount: result.config.providers?.length },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });
      return result;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelChangeRequestCreateIam", LogCategory.SECURITY).warn(
        "Channel change-request creation shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}
