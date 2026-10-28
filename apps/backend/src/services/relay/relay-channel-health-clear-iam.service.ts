import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { RelayChannelHealthClearRepository } from "@/store/relay/relay-channel-health-clear.repository";
import { assertIamAccountPrincipal, iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { PermissionService } from "@/services/users/permission.service";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { batchDeleteRelayChannelsBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { BatchRelayChannelsResultDto } from "@/api/dto/relay/relay-channel.dto";
import { requestTransportConditionContext } from "@/iam/request/condition-context";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { RelayChannelHealthService } from "./relay-channel-health.service";
const action = "quyan:relay:ClearChannelHealth";
type ExternalEffect = "not-attempted" | "uncertain" | "confirmed";
export class RelayChannelHealthClearIamService {
  private static instance: RelayChannelHealthClearIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelHealthClearIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository = RelayChannelHealthClearRepository.getInstance(),
    private readonly snapshots = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async execute(
    input: { ids: string[] },
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<BatchRelayChannelsResultDto>,
  ): Promise<BatchRelayChannelsResultDto> {
    const parsed = batchDeleteRelayChannelsBodySchema.safeParse(input);
    if (!parsed.success || parsed.data.ids.some((id) => !isPlatformLogResourceId(id)))
      throw new BadRequestError("Invalid channel health clear request", undefined, {
        messageKey: "errors.badRequest",
      });
    const { ids } = parsed.data,
      mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const current = getIamPrincipal(request);
    if (
      !current ||
      current.subjectUserId !== actorUserId ||
      current.principalUserId !== actorUserId ||
      request.oauthAccessToken
    )
      throw iamAccountDenied();
    const principal: IamPrincipal = { ...current };
    if (
      mode !== "enforce" &&
      !(
        await this.permissions.checkUserPermissions(actorUserId, [Permission.RELAY_CHANNEL_UPDATE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (executeEffect: boolean) => {
      const state: { externalEffect: ExternalEffect; requestAccepted: boolean } = {
        externalEffect: "not-attempted",
        requestAccepted: false,
      };
      const transport = requestTransportConditionContext(request),
        requestId = request.res?.locals.requestId;
      const audit = () => ({
        action,
        principalUserId: principal.principalUserId,
        subjectType: principal.subjectType,
        accountOwnerId: principal.accountOwnerId,
        requestId,
        authorizationMode: mode,
        resourceHashes: ids.map((id) => createHash("sha256").update(platformRelayChannelArn(id)).digest("hex")),
        channelCount: ids.length,
        ...state,
      });
      try {
        const snapshot = await this.snapshots.snapshot(principal, Permission.RELAY_CHANNEL_UPDATE),
          fingerprint = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
        const keyId = request.accessKey?.id,
          keyRevision = await captureIamAccessKeyRevision(principal, keyId);
        const assertRequest = () => {
          if (
            env.security.iamAuthorizationMode !== mode ||
            JSON.stringify(getIamPrincipal(request)) !== JSON.stringify(principal) ||
            request.accessKey?.id !== keyId ||
            Boolean(request.oauthAccessToken)
          )
            throw iamAccountDenied();
        };
        const recheck = async (tx?: Prisma.TransactionClient) => {
          assertRequest();
          if (tx) {
            await assertIamAccountPrincipal(principal, tx);
            const group = await platformManagementGroupSnapshot(principal, Permission.RELAY_CHANNEL_UPDATE, tx);
            const users = await tx.user.findMany({
              where: { id: { in: snapshot.users.map((row) => row.id) }, status: 1 },
              select: { id: true, updateTime: true },
            });
            if (
              JSON.stringify(group) !== JSON.stringify(snapshot.group) ||
              users.length !== snapshot.users.length ||
              users.some(
                (row) =>
                  !snapshot.users.some(
                    (old) => old.id === row.id && old.updateTime.getTime() === row.updateTime.getTime(),
                  ),
              )
            )
              throw iamAccountDenied();
          } else await this.snapshots.recheck(principal, Permission.RELAY_CHANNEL_UPDATE, snapshot);
          if (
            fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint ||
            (await captureIamAccessKeyRevision(principal, keyId, tx)) !== keyRevision
          )
            throw iamAccountDenied();
          const decisions = await platformCollectionDecisions(this.iam, {
            principal,
            action,
            request,
            resources: ids.map(platformRelayChannelArn),
          });
          if (decisions.some((decision) => decision !== "Allow")) throw iamAccountDenied();
          assertRequest();
        };
        await recheck();
        const targets = await this.repository.candidates(ids);
        await recheck();
        const result = await this.repository.withAdmission(
          targets,
          { principal, snapshot, recheck },
          executeEffect
            ? async () => {
                state.externalEffect = "uncertain";
                getLogger("RelayChannelHealthClearIam", LogCategory.SECURITY).info(
                  "Channel health clear admitted",
                  audit(),
                );
                if ((await RelayChannelHealthService.getInstance().clearHealthMany(ids)) !== true)
                  throw new BadRequestError("Channel health storage is temporarily unavailable", undefined, {
                    messageKey: "relayChannel.healthStorageUnavailable",
                  });
                state.externalEffect = "confirmed";
              }
            : undefined,
        );
        state.requestAccepted = true;
        return result;
      } finally {
        if (state.externalEffect !== "not-attempted") {
          // Emit after transaction settlement so a rejected response never hides an irreversible external effect.
          getLogger("RelayChannelHealthClearIam", LogCategory.SECURITY).info("Channel health clear outcome", audit());
          await BusinessLogService.getInstance()
            .logOperation({
              operationType: OperationType.RELAY_CHANNEL_UPDATE,
              operationCategory: OperationCategory.RELAY,
              actorUserId: principal.subjectUserId,
              targetResourceType: "RELAY_CHANNEL",
              targetResourceId: ids.length === 1 ? ids[0] : undefined,
              description: "清除中转渠道健康统计",
              metadata: { ids, ...state },
              success: state.externalEffect === "confirmed" && state.requestAccepted,
              ipAddress: typeof transport["acs:SourceIp"] === "string" ? transport["acs:SourceIp"] : "unknown",
              requestId,
            })
            .catch(() => {
              getLogger("RelayChannelHealthClearIam", LogCategory.SECURITY).warn(
                "Channel health clear business audit unavailable",
                audit(),
              );
            });
        }
      }
    };
    if (mode === "enforce") return native(true);
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelHealthClearIam", LogCategory.SECURITY).warn(
        "Channel health clear shadow evaluation failed",
        {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        },
      );
    }
    return legacy();
  }
}
