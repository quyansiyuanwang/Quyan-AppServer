import { projectAuthorizedRelayChannelMutation } from "./relay-channel-authorized-mutation-projection";
import {
  RelayChannelUpdateRepository,
  type ChannelUpdatePreparation,
  type ChannelUpdateProviderPreparation,
} from "@/store/relay/relay-channel-update.repository";
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
import { assertIamAccountPrincipal, iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { PermissionService } from "../users/permission.service";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { updateRelayChannelBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { RelayChannelProviderConfigRepository } from "@/store/relay/relay-channel-provider-config.repository";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import BusinessLogService from "../system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { TypedRequest } from "@/types/express";
import type { RelayChannelDto, UpdateRelayChannelRequest } from "@/api/dto/relay/relay-channel.dto";
const action = "quyan:relay:UpdateChannel";
/** Administrative updates, related resources and safe responses share one final transaction boundary. */
export class RelayChannelUpdateIamService {
  private static instance: RelayChannelUpdateIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelUpdateIamService());
  }
  async execute(
    id: string,
    input: UpdateRelayChannelRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    prepare: ChannelUpdatePreparation,
    prepareProvider: ChannelUpdateProviderPreparation,
    legacy: () => Promise<RelayChannelDto>,
  ): Promise<RelayChannelDto> {
    const parsed = updateRelayChannelBodySchema.safeParse(input);
    if (!parsed.success || !isPlatformLogResourceId(id))
      throw new BadRequestError("Invalid channel update request", undefined, { messageKey: "errors.badRequest" });
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
        repository = RelayChannelUpdateRepository.getInstance(),
        snapshot = await snapshots.snapshot(principal, Permission.RELAY_CHANNEL_UPDATE),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId),
        resources = new Set([platformRelayChannelArn(id)]);
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
          resources: [...resources],
        });
        if (decisions.length !== resources.size || decisions.some((decision) => decision !== "Allow"))
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck(); // Admit the target before resolving provider names or reading configuration.
      const providers =
        data.providers === undefined
          ? undefined
          : await RelayChannelProviderConfigRepository.getInstance().providers(data.providers);
      return repository.apply(
        id,
        data,
        providers,
        {
          principal,
          snapshot,
          recheck,
          admit: async (ids, providerIds = []) => {
            for (const related of ids) {
              if (!isPlatformLogResourceId(related)) throw iamAccountDenied();
              resources.add(platformRelayChannelArn(related));
            }
            for (const userId of providerIds) resources.add(platformRelayChannelProviderArn(id, userId));
            await recheck();
          },
        },
        persist,
        prepare,
        prepareProvider,
        (tx) => projectAuthorizedRelayChannelMutation(tx, { principal, action, request, id, recheck }),
        async (tx) => {
          await BusinessLogService.getInstance().logOperation(
            {
              operationType: OperationType.RELAY_CHANNEL_UPDATE,
              operationCategory: OperationCategory.RELAY,
              actorUserId,
              targetResourceId: id,
              targetResourceType: "RELAY_CHANNEL",
              description: "Updated an authorized channel configuration",
              metadata: { fields: Object.keys(data) },
              success: true,
              ...buildBusinessLogRequestContext(request),
            },
            tx,
          );
        },
      );
    };
    if (mode === "enforce") {
      const result = await native(true);
      if (!result) throw iamAccountDenied();
      return result;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelUpdateIam", LogCategory.SECURITY).warn("Channel update shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
