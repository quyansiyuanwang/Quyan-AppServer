import { createId } from "@paralleldrive/cuid2";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "../users/permission.service";
import { channelCreationAuthority } from "./relay-channel-creation-authority";
import { projectAuthorizedRelayChannelMutations } from "./relay-channel-authorized-mutation-projection";
import { RelayChannelImportRepository } from "@/store/relay/relay-channel-import.repository";
import { RelayChannelProviderConfigRepository } from "@/store/relay/relay-channel-provider-config.repository";
import type {
  ChannelCreatePreparation,
  ChannelCreateProviderPreparation,
} from "@/store/relay/relay-channel-creation-proof";
import { importRelayChannelsBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import BusinessLogService from "../system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { TypedRequest } from "@/types/express";
import type { ImportRelayChannelsRequest, ImportRelayChannelsResponse } from "@/api/dto/relay/relay-channel.dto";
const action = "quyan:relay:ImportChannels",
  referenceAction = "quyan:relay:UseChannelCreationReference";
export class RelayChannelImportIamService {
  private static instance: RelayChannelImportIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelImportIamService());
  }
  async execute(
    input: ImportRelayChannelsRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    prepare: ChannelCreatePreparation,
    prepareProvider: ChannelCreateProviderPreparation,
    copyName: (name: string, reserved: Set<string>) => string,
    legacy: () => Promise<ImportRelayChannelsResponse>,
  ): Promise<ImportRelayChannelsResponse> {
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
    const parsed = importRelayChannelsBodySchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid channel import request", undefined, { messageKey: "errors.badRequest" });
    const data = parsed.data,
      sourceIds = data.channels.filter((row) => row.id).map((row) => row.id!);
    if (sourceIds.length && sourceIds.length !== data.channels.length)
      throw new BadRequestError("Imported source IDs must be consistent", undefined, {
        messageKey: "relayChannel.importSourceIdsConsistent",
      });
    if (new Set(sourceIds).size !== sourceIds.length)
      throw new BadRequestError("Imported source IDs must be unique", undefined, {
        messageKey: "relayChannel.importSourceIdsUnique",
      });
    const targets = data.channels.map((input) => ({ id: createId(), input })),
      ids = targets.map((row) => row.id);
    if (ids.some((id) => !isPlatformLogResourceId(id)) || new Set(ids).size !== ids.length) throw iamAccountDenied();
    const native = async (persist: boolean) => {
      const authority = await channelCreationAuthority(principal, request, mode, action, referenceAction, ids);
      const providerRepository = RelayChannelProviderConfigRepository.getInstance(),
        resolved = [];
      for (const target of targets)
        resolved.push({
          ...target,
          providers:
            target.input.providers === undefined
              ? undefined
              : await providerRepository.providers(target.input.providers),
        });
      return RelayChannelImportRepository.getInstance().import(
        resolved,
        authority,
        persist,
        prepare,
        prepareProvider,
        copyName,
        (tx) =>
          projectAuthorizedRelayChannelMutations(tx, {
            principal,
            action,
            relatedAction: referenceAction,
            request,
            ids,
            recheck: authority.recheck,
          }),
        async (tx) => {
          await BusinessLogService.getInstance().logOperation(
            {
              operationType: OperationType.RELAY_CHANNEL_IMPORT,
              operationCategory: OperationCategory.RELAY,
              actorUserId,
              targetResourceType: "RELAY_CHANNEL",
              description: "Imported authorized channel configurations",
              metadata: { total: ids.length, created: ids.length },
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
      return { code: 0, message: "success", total: ids.length, created: result.length, data: result };
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelImportIam", LogCategory.SECURITY).warn("Channel import shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
