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
import { RelayChannelSubmissionReviewRepository } from "@/store/relay/relay-channel-submission-review.repository";
import { assertIamAccountPrincipal, iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { PermissionService } from "../users/permission.service";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { reviewRelayChannelSubmissionBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import BusinessLogService from "../system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { TypedRequest } from "@/types/express";
import type { RelayChannelDto, ReviewRelayChannelSubmissionRequest } from "@/api/dto/relay/relay-channel.dto";
import { RelayChannelConfigurationReadRepository } from "@/store/relay/relay-channel-configuration-read.repository";
import { projectRelayChannelConfiguration } from "./relay-channel-configuration-projection";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import { formatRelayRequestFormats } from "@quyan/shared";
const action = "quyan:relay:ReviewChannelSubmission";
/** Review and its safe configuration response share a final authorization/transaction boundary. */
export class RelayChannelSubmissionReviewIamService {
  private static instance: RelayChannelSubmissionReviewIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelSubmissionReviewIamService());
  }
  async execute(
    id: string,
    input: ReviewRelayChannelSubmissionRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayChannelDto>,
  ): Promise<RelayChannelDto> {
    const parsed = reviewRelayChannelSubmissionBodySchema.safeParse(input);
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
        repository = RelayChannelSubmissionReviewRepository.getInstance(),
        snapshot = await snapshots.snapshot(principal, Permission.RELAY_CHANNEL_REVIEW),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId),
        resources = [platformRelayChannelArn(id)];
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
      await recheck(); // Admit the channel before reading its source/provider metadata.
      const target = await repository.candidate(id);
      if (data.action === "approve") {
        const recipients = [...new Set([...target.providers.map((row) => row.userId), target.submittedByUserId!])];
        resources.push(...recipients.map((userId) => platformRelayChannelProviderArn(id, userId)));
      }
      await recheck(); // Activating a revenue relation requires its explicit resource grant, including implicit self.
      return repository.apply(target, data, { principal, snapshot, recheck }, persist, async (tx) => {
        const result = await RelayChannelConfigurationReadRepository.getInstance().read(
          principal,
          { id, includeDisabled: true },
          (targets) => platformCollectionDecisions(iam, { principal, action, request, resources: targets }),
          () => recheck(tx),
          async ({ records, context, verify }) => {
            if (records.length !== 1 || records[0]!.source.id !== id || !verify) throw iamAccountDenied();
            const { source, presence } = records[0]!,
              value = projectRelayChannelConfiguration(source, presence),
              capabilities = await RelayPoolResolverService.getInstance().resolveChannelCapabilities(id, context);
            value.allowedModels = [...new Set(capabilities.map((row) => row.catalogModelName))].sort();
            if (["pooled", "automatic-proxy-pool"].includes(value.channelType))
              value.allowedFormats = formatRelayRequestFormats([
                ...new Set(capabilities.flatMap((row) => row.supportedRequestFormats)),
              ]);
            return { value, verify };
          },
          tx,
        );
        if (!result) throw iamAccountDenied();
        return result;
      });
    };
    if (mode === "enforce") {
      const result = await native(true);
      if (!result) throw iamAccountDenied();
      await BusinessLogService.getInstance().logOperation({
        operationType: OperationType.RELAY_CHANNEL_UPDATE,
        operationCategory: OperationCategory.RELAY,
        actorUserId,
        targetResourceId: id,
        targetResourceType: "RELAY_CHANNEL",
        description: "Reviewed an authorized channel submission",
        metadata: { action: data.action },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });
      return result;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelSubmissionReviewIam", LogCategory.SECURITY).warn(
        "Channel review shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}
