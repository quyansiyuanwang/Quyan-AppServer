import { createId } from "@paralleldrive/cuid2";
import { projectAuthorizedRelayChannelMutations } from "./relay-channel-authorized-mutation-projection";
import {
  RelayChannelDuplicateRepository,
  type ChannelDuplicatePreparation,
} from "@/store/relay/relay-channel-duplicate.repository";
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
import { assertIamAccountPrincipal, iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { PermissionService } from "../users/permission.service";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import {
  batchDuplicateRelayChannelsBodySchema,
  duplicateRelayChannelBodySchema,
} from "@/api/schema/relay/relay-channel.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import BusinessLogService from "../system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { TypedRequest } from "@/types/express";
import type { RelayChannelDto, DuplicateRelayChannelRequest } from "@/api/dto/relay/relay-channel.dto";
const action = "quyan:relay:DuplicateChannels",
  destinationAction = "quyan:relay:CreateChannelCopy";
/** Single and batch copies and their safe configuration responses share a final authorization/transaction boundary. */
export class RelayChannelDuplicateIamService {
  private static instance: RelayChannelDuplicateIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelDuplicateIamService());
  }
  async execute(
    variant: "single" | "batch",
    ids: readonly string[],
    input: DuplicateRelayChannelRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayChannelDto[]>,
    prepare: ChannelDuplicatePreparation,
    copyName: (name: string, reserved: Set<string>) => string,
  ): Promise<RelayChannelDto[]> {
    const parsed = batchDuplicateRelayChannelsBodySchema.safeParse({ ids }),
      name = duplicateRelayChannelBodySchema.safeParse(input);
    if (
      !parsed.success ||
      !name.success ||
      parsed.data.ids.some((id) => !isPlatformLogResourceId(id)) ||
      (variant === "single" && ids.length !== 1) ||
      (variant === "batch" && name.data.name !== undefined)
    )
      throw new BadRequestError("Invalid channel duplication request", undefined, { messageKey: "errors.badRequest" });
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
        await PermissionService.getInstance().checkUserPermissions(actorUserId, [Permission.RELAY_CHANNEL_CREATE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (persist: boolean) => {
      const iam = IamAuthorizationService.getInstance(),
        snapshots = PlatformManagementReadRepository.getInstance(),
        repository = RelayChannelDuplicateRepository.getInstance(),
        snapshot = await snapshots.snapshot(principal, Permission.RELAY_CHANNEL_CREATE),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId),
        targets = data.ids.map((sourceId) => ({ sourceId, id: createId(), name: name.data.name })),
        resources = new Set(targets.map((target) => platformRelayChannelArn(target.sourceId))),
        destinationResources = targets.map((target) => platformRelayChannelArn(target.id));
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
          const group = await platformManagementGroupSnapshot(principal, Permission.RELAY_CHANNEL_CREATE, tx),
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
        } else await snapshots.recheck(principal, Permission.RELAY_CHANNEL_CREATE, snapshot);
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
        const destinations = await platformCollectionDecisions(iam, {
          principal,
          action: destinationAction,
          request,
          resources: destinationResources,
        });
        if (
          destinations.length !== destinationResources.length ||
          destinations.some((decision) => decision !== "Allow")
        )
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck(); // Admit the entire batch before reading configuration or model metadata.
      return repository.apply(
        targets,
        {
          principal,
          snapshot,
          recheck,
          admit: async (ids) => {
            for (const id of ids) {
              if (!isPlatformLogResourceId(id)) throw iamAccountDenied();
              resources.add(platformRelayChannelArn(id));
            }
            await recheck();
          },
        },
        persist,
        prepare,
        copyName,
        (tx, ids) =>
          projectAuthorizedRelayChannelMutations(tx, {
            principal,
            action: destinationAction,
            relatedAction: action,
            request,
            ids,
            recheck,
          }),
        async (tx) => {
          await BusinessLogService.getInstance().logOperation(
            {
              operationType:
                variant === "single"
                  ? OperationType.RELAY_CHANNEL_DUPLICATE
                  : OperationType.RELAY_CHANNEL_BATCH_DUPLICATE,
              operationCategory: OperationCategory.RELAY,
              actorUserId,
              targetResourceType: "RELAY_CHANNEL",
              description: "Duplicated authorized channel configurations",
              metadata: { ids: data.ids, destinationIds: targets.map((row) => row.id), total: targets.length },
              success: true,
              ...buildBusinessLogRequestContext(request),
            },
            tx,
          );
        },
      );
    };
    if (mode === "enforce") return native(true);
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelDuplicateIam", LogCategory.SECURITY).warn("Channel duplication shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
