import { isDeepStrictEqual as same } from "node:util";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { relayChannelSubmissionArn } from "@/iam/resources/relay-channel-submission-resources";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import {
  assertIamAccountPrincipal,
  IamAccountUserRepository,
  iamAccountDenied,
} from "@/store/users/iam-account-principal";
import {
  RelayChannelSubmissionMutationRepository,
  type SubmissionMutation,
} from "@/store/relay/relay-channel-submission-mutation.repository";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PermissionService } from "../users/permission.service";
import BusinessLogService from "../system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { projectRelayChannelConfiguration } from "./relay-channel-configuration-projection";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { RelayChannelDto } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
export class RelayChannelSubmissionMutationIamService {
  private static instance: RelayChannelSubmissionMutationIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelSubmissionMutationIamService());
  }
  async execute(
    input: SubmissionMutation,
    id: string,
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayChannelDto | void>,
  ): Promise<RelayChannelDto | undefined> {
    if (
      !isRelayTokenResourceId(id) ||
      !input ||
      !["delete", "service-status"].includes(input.operation) ||
      (input.operation === "service-status" && typeof input.enabled !== "boolean")
    )
      throw new BadRequestError("Invalid submission lifecycle request", undefined, { messageKey: "errors.badRequest" });
    input = { ...input };
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    const invokeLegacy = async () => (await legacy()) ?? undefined;
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return invokeLegacy();
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
    const action =
      input.operation === "delete"
        ? "quyan:relay:DeleteMyChannelSubmission"
        : "quyan:relay:SetMyChannelSubmissionServiceStatus";
    if (
      mode !== "enforce" &&
      !(
        await PermissionService.getInstance().checkUserPermissions(actorUserId, [Permission.RELAY_CHANNEL_SUBMIT], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return invokeLegacy();
    const native = async (persist: boolean) => {
      const iam = IamAuthorizationService.getInstance(),
        repository = RelayChannelSubmissionMutationRepository.getInstance();
      const keyId = request.accessKey?.id;
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
        const decisions = await platformCollectionDecisions(iam, {
          principal,
          action,
          request,
          resources: [relayChannelSubmissionArn(principal.accountOwnerId, principal.subjectUserId, id)],
        });
        if (decisions.length !== 1 || decisions[0] !== "Allow") throw iamAccountDenied();
        assertRequest();
      };
      await recheck();
      const target = await repository.target(principal, id);
      await recheck();
      return repository.apply(
        target,
        input,
        { principal, users, recheck },
        persist,
        async (source, presence, context) => {
          const dto = projectRelayChannelConfiguration(source, presence);
          const capabilities = await RelayPoolResolverService.getInstance().resolveChannelCapabilities(
            source.id,
            context,
          );
          dto.allowedModels = [...new Set(capabilities.map((value) => value.catalogModelName))].sort();
          return dto;
        },
      );
    };
    if (mode === "enforce") {
      const result = await native(true);
      await BusinessLogService.getInstance().logOperation({
        operationType:
          input.operation === "delete" ? OperationType.RELAY_CHANNEL_DELETE : OperationType.RELAY_CHANNEL_STATUS_CHANGE,
        operationCategory: OperationCategory.RELAY,
        actorUserId,
        targetResourceId: id,
        targetResourceType: "RELAY_CHANNEL",
        description:
          input.operation === "delete"
            ? "Deleted an owned channel submission"
            : "Changed owned channel submission service status",
        changes: input.operation === "delete" ? undefined : { providerServiceEnabled: input.enabled },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });
      return result;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelSubmissionMutationIam", LogCategory.SECURITY).warn(
        "Channel submission mutation shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return invokeLegacy();
  }
}
