import { channelCreationAuthority } from "./relay-channel-creation-authority";
import { createId } from "@paralleldrive/cuid2";
import { projectAuthorizedRelayChannelMutation } from "./relay-channel-authorized-mutation-projection";
import {
  RelayChannelCreateRepository,
  type ChannelCreatePreparation,
  type ChannelCreateProviderPreparation,
} from "@/store/relay/relay-channel-create.repository";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "../users/permission.service";
import { createRelayChannelBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { RelayChannelProviderConfigRepository } from "@/store/relay/relay-channel-provider-config.repository";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import BusinessLogService from "../system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { TypedRequest } from "@/types/express";
import type { RelayChannelDto, CreateRelayChannelRequest } from "@/api/dto/relay/relay-channel.dto";
const action = "quyan:relay:CreateChannel",
  referenceAction = "quyan:relay:UseChannelCreationReference";
/** New destinations, existing references and safe responses share one final transaction boundary. */
export class RelayChannelCreateIamService {
  private static instance: RelayChannelCreateIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelCreateIamService());
  }
  async execute(
    input: CreateRelayChannelRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    prepare: ChannelCreatePreparation,
    prepareProvider: ChannelCreateProviderPreparation,
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
    const id = createId(),
      parsed = createRelayChannelBodySchema.safeParse(input);
    if (!parsed.success || !isPlatformLogResourceId(id))
      throw new BadRequestError("Invalid channel creation request", undefined, { messageKey: "errors.badRequest" });
    const data = parsed.data;
    const native = async (persist: boolean) => {
      const authority = await channelCreationAuthority(principal, request, mode, action, referenceAction, [id]),
        { snapshot, recheck } = authority,
        repository = RelayChannelCreateRepository.getInstance();
      await recheck(); // Admit the target before resolving provider names or reading configuration.
      const providers =
        data.providers === undefined
          ? undefined
          : await RelayChannelProviderConfigRepository.getInstance().providers(data.providers);
      return repository.create(
        id,
        data,
        providers,
        {
          principal,
          snapshot,
          recheck,
          admit: async (ids, providerIds = []) => {
            await authority.admitReferences(ids);
            await authority.admitProviders(id, providerIds);
          },
        },
        persist,
        prepare,
        prepareProvider,
        (tx) =>
          projectAuthorizedRelayChannelMutation(tx, {
            principal,
            action,
            relatedAction: referenceAction,
            request,
            id,
            recheck,
          }),
        async (tx) => {
          await BusinessLogService.getInstance().logOperation(
            {
              operationType: OperationType.RELAY_CHANNEL_CREATE,
              operationCategory: OperationCategory.RELAY,
              actorUserId,
              targetResourceId: id,
              targetResourceType: "RELAY_CHANNEL",
              description: "Created an authorized channel configuration",
              metadata: { channelType: data.channelType ?? "standalone", providerCount: data.providers?.length ?? 0 },
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
      getLogger("RelayChannelCreateIam", LogCategory.SECURITY).warn("Channel creation shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
