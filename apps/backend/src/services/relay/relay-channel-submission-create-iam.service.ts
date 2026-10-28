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
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import {
  assertIamAccountPrincipal,
  IamAccountUserRepository,
  iamAccountDenied,
} from "@/store/users/iam-account-principal";
import {
  RelayChannelSubmissionCreateRepository,
  type SubmissionCreatePreparation,
} from "@/store/relay/relay-channel-submission-create.repository";
import { submitRelayChannelBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PermissionService } from "../users/permission.service";
import BusinessLogService from "../system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { projectRelayChannelConfiguration } from "./relay-channel-configuration-projection";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { RelayChannelDto, SubmitRelayChannelRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:CreateMyChannelSubmission";
export class RelayChannelSubmissionCreateIamService {
  private static instance: RelayChannelSubmissionCreateIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelSubmissionCreateIamService());
  }
  async execute(
    input: SubmitRelayChannelRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    channel: SubmissionCreatePreparation["channel"],
    provider: SubmissionCreatePreparation["provider"],
    legacy: () => Promise<RelayChannelDto>,
  ): Promise<RelayChannelDto> {
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
    const parsed = submitRelayChannelBodySchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid channel submission", undefined, { messageKey: "errors.badRequest" });
    const data = parsed.data,
      id = createId();
    if (!isRelayTokenResourceId(id)) throw iamAccountDenied();
    const native = async (persist: boolean) => {
      const iam = IamAuthorizationService.getInstance(),
        repository = RelayChannelSubmissionCreateRepository.getInstance();
      const keyId = request.accessKey?.id,
        resources = [relayChannelSubmissionArn(principal.accountOwnerId, principal.subjectUserId, id)];
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
      await recheck(); // Admit the reserved channel before resolving any provider names.
      const targets = await repository.providers(principal, data.providers ?? []);
      if (targets.some((target) => !isRelayTokenResourceId(target.user.id))) throw iamAccountDenied();
      resources.push(
        ...targets.map((target) =>
          relayChannelSubmissionProviderArn(principal.accountOwnerId, principal.subjectUserId, id, target.user.id),
        ),
      );
      await recheck(); // Every proposed provider, including the implicit submitter, requires its own relation grant.
      return repository.create(
        id,
        data,
        targets,
        { principal, users, recheck },
        { channel, provider },
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
      if (!result) throw iamAccountDenied();
      await BusinessLogService.getInstance().logOperation({
        operationType: OperationType.RELAY_CHANNEL_CREATE,
        operationCategory: OperationCategory.RELAY,
        actorUserId,
        targetResourceId: id,
        targetResourceType: "RELAY_CHANNEL",
        description: "Created an owned channel submission pending review",
        changes: { submissionStatus: "pending", providerCount: result.providers.length },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });
      return result;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelSubmissionCreateIam", LogCategory.SECURITY).warn(
        "Channel submission creation shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}
