import { isDeepStrictEqual as same } from "node:util";
import { projectAuthorizedRelayChannelMutation } from "./relay-channel-authorized-mutation-projection";
import type { SubmissionProviderInput } from "@/store/relay/relay-channel-submission-create.repository";
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
import { RelayChannelProviderConfigRepository } from "@/store/relay/relay-channel-provider-config.repository";
import { assertIamAccountPrincipal, iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { PermissionService } from "../users/permission.service";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { updateRelayChannelProviderConfigBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import BusinessLogService from "../system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { TypedRequest } from "@/types/express";
import type {
  RelayChannelDto,
  UpdateRelayChannelProviderConfigRequest,
  RelayChannelProviderConfigRequest,
} from "@/api/dto/relay/relay-channel.dto";
const action = "quyan:relay:UpdateChannelProviderConfig";
const eligibility = [Permission.RELAY_CHANNEL_REVIEW, Permission.RELAY_CHANNEL_UPDATE] as const;
/** Provider configuration and its safe response share a final authorization/transaction boundary. */
export class RelayChannelProviderConfigIamService {
  private static instance: RelayChannelProviderConfigIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelProviderConfigIamService());
  }
  async execute(
    id: string,
    input: UpdateRelayChannelProviderConfigRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayChannelDto>,
    prepare: (input: RelayChannelProviderConfigRequest, userId: string, now: Date) => SubmissionProviderInput,
  ): Promise<RelayChannelDto> {
    const parsed = updateRelayChannelProviderConfigBodySchema.safeParse(input);
    if (!parsed.success || !isPlatformLogResourceId(id))
      throw new BadRequestError("Invalid provider configuration request", undefined, {
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
        await Promise.all(
          eligibility.map((permission) =>
            PermissionService.getInstance().checkUserPermissions(actorUserId, [permission], {
              assumedRoleSessionId: principal.roleSessionId,
            }),
          ),
        )
      ).some((result) => result.hasPermission)
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (persist: boolean) => {
      const iam = IamAuthorizationService.getInstance(),
        snapshots = PlatformManagementReadRepository.getInstance(),
        repository = RelayChannelProviderConfigRepository.getInstance(),
        snapshot = await snapshots.snapshot(principal, eligibility),
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
          const group = await platformManagementGroupSnapshot(principal, eligibility, tx),
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
        } else await snapshots.recheck(principal, eligibility, snapshot);
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
      await recheck(); // Source/proposed identities are resolved only after channel admission.
      const target = await repository.candidate(id),
        targets = data.providers === undefined ? undefined : await repository.providers(data.providers);
      if (targets) {
        const recipients = [
          ...new Set([...target.providers.map((row) => row.userId), ...targets.map((row) => row.user.id)]),
        ];
        resources.push(...recipients.map((userId) => platformRelayChannelProviderArn(id, userId)));
      }
      await recheck(); // Removal is a mutation too: require every old and new relation, never just the first.
      return repository.apply(target, data, targets, { principal, snapshot, recheck }, persist, prepare, (tx) =>
        projectAuthorizedRelayChannelMutation(tx, { principal, action, request, id, recheck }),
      );
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
        description: "Updated authorized channel provider configuration",
        metadata: { providerCount: data.providers?.length, multiplierChanged: data.multiplier !== undefined },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });
      return result;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelProviderConfigIam", LogCategory.SECURITY).warn(
        "Channel provider configuration shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}
