import { relayChannelUpstreamModelsBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { resolveUpstreamModelScope } from "@/iam/request/relay-upstream-model-resource-resolver";
import { createUpstreamModelReadAuthority } from "./relay-upstream-model-authority";
import axios from "axios";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { RelayChannelUpstreamModelRepository } from "@/store/relay/relay-channel-upstream-model.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "../users/permission.service";
import { batchRelayChannelUpstreamModelsBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import {
  relayUpstreamModelsPolicy,
  type UpstreamModelConfiguration,
  type UpstreamModelExecutionGuard,
} from "./relay-upstream-models";
import type { TypedRequest } from "@/types/express";
import type {
  BatchRelayChannelUpstreamModelsResponse,
  BatchRelayChannelUpstreamModelsRequest,
  RelayChannelUpstreamModelsResponse,
  RelayChannelUpstreamModelsRequest,
} from "@/api/dto/relay/relay-channel.dto";
const action = "quyan:relay:BatchListUpstreamModels";
/** Separate batch admission, guarded sends and final disclosure; never hold database locks over HTTP. */
export class RelayChannelUpstreamModelIamService {
  private static instance: RelayChannelUpstreamModelIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelUpstreamModelIamService());
  }
  async single(
    input: RelayChannelUpstreamModelsRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayChannelUpstreamModelsResponse>,
    query: (
      format: RelayChannelUpstreamModelsRequest["format"],
      configuration: UpstreamModelConfiguration,
      guard: UpstreamModelExecutionGuard,
    ) => Promise<RelayChannelUpstreamModelsResponse>,
  ): Promise<RelayChannelUpstreamModelsResponse> {
    const parsed = relayChannelUpstreamModelsBodySchema.safeParse(input);
    if (!parsed.success || (parsed.data.channelId && !isPlatformLogResourceId(parsed.data.channelId)))
      throw new BadRequestError("Invalid upstream model request", undefined, { messageKey: "errors.badRequest" });
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
    if (mode !== "enforce") {
      const checked = await PermissionService.getInstance().checkUserPermissions(
        actorUserId,
        [Permission.RELAY_CHANNEL_REVIEW, Permission.RELAY_CHANNEL_UPDATE, Permission.RELAY_CHANNEL_SUBMIT],
        { assumedRoleSessionId: principal.roleSessionId },
      );
      if (!checked.checkedPermissions.some((permission) => !checked.missingPermissions?.includes(permission)))
        throw iamAccountDenied();
    }
    if (mode === "legacy") return legacy();
    const singleAction = "quyan:relay:ListUpstreamModels";
    const native = async (send: boolean) => {
      const { resource, scope } = await resolveUpstreamModelScope(principal, data);
      const { guard } = await createUpstreamModelReadAuthority({
        principal,
        request,
        mode,
        action: singleAction,
        resources: [resource],
        scope,
      });
      if (!send) return undefined;
      const repository = RelayChannelUpstreamModelRepository.getInstance(),
        captured = await repository.capture(data.channelId ? [data.channelId] : [], data.format, guard);
      // Saved channels always ignore supplied raw URL/key. Preview never reads any saved channel.
      const config = data.channelId
        ? captured.configurations[0]!
        : { upstreamUrl: data.upstreamUrl?.trim(), apiKey: data.apiKey?.trim(), useProxy: false };
      const verify = () => repository.verify(captured.snapshot, data.format, guard);
      if (!config.upstreamUrl || !config.apiKey) {
        await verify();
        throw new BadRequestError("Missing upstream model configuration", undefined, {
          messageKey: "relayChannel.upstreamConfigMissingForFormat",
        });
      }
      let authorizationFailed = false;
      const beforeSend = async () => {
        try {
          await verify();
        } catch {
          authorizationFailed = true;
          throw iamAccountDenied();
        }
      };
      let response: RelayChannelUpstreamModelsResponse;
      try {
        response = await query(data.format, config, { catalog: captured.snapshot.catalog, beforeSend });
      } catch {
        if (authorizationFailed) throw iamAccountDenied();
        await verify(); // A simultaneous revocation is never reported as an upstream business error.
        throw new BadRequestError("Upstream model request failed", undefined, {
          messageKey: "relayChannel.upstreamModelListFailed",
        });
      }
      await verify();
      return response;
    };
    if (mode === "enforce") {
      const result = await native(true);
      if (!result) throw iamAccountDenied();
      return result;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelUpstreamModelIam", LogCategory.SECURITY).warn(
        "Single upstream model shadow evaluation failed",
        { action: singleAction, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
  async batch(
    input: BatchRelayChannelUpstreamModelsRequest,
    actorUserId: string | undefined,
    request: TypedRequest | undefined,
    legacy: () => Promise<BatchRelayChannelUpstreamModelsResponse>,
    query: (
      format: BatchRelayChannelUpstreamModelsRequest["format"],
      configuration: UpstreamModelConfiguration,
      guard: UpstreamModelExecutionGuard,
    ) => Promise<RelayChannelUpstreamModelsResponse>,
  ): Promise<BatchRelayChannelUpstreamModelsResponse> {
    const parsed = batchRelayChannelUpstreamModelsBodySchema.safeParse(input);
    if (!parsed.success || parsed.data.ids.some((id) => !isPlatformLogResourceId(id)))
      throw new BadRequestError("Invalid upstream model batch", undefined, { messageKey: "errors.badRequest" });
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
        await PermissionService.getInstance().checkUserPermissions(actorUserId!, [Permission.RELAY_CHANNEL_UPDATE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (send: boolean): Promise<BatchRelayChannelUpstreamModelsResponse> => {
      const repository = RelayChannelUpstreamModelRepository.getInstance(),
        resources = data.ids.map(platformRelayChannelArn);
      const { guard, recheck } = await createUpstreamModelReadAuthority({
        principal,
        request,
        mode,
        action,
        resources,
        scope: { kind: "platform", permissions: Permission.RELAY_CHANNEL_UPDATE },
      });
      if (!send) return { format: data.format, items: [] }; // Shadow never captures stored keys or probes twice.
      const captured = await repository.capture(data.ids, data.format, guard);
      let cancelled = false;
      const verify = async (id?: string) => {
        if (cancelled) throw iamAccountDenied();
        try {
          await repository.verify(
            captured.snapshot,
            data.format,
            id ? { ...guard, recheck: (tx) => recheck(tx, [platformRelayChannelArn(id)]) } : guard,
            id,
          );
        } catch {
          cancelled = true;
          throw iamAccountDenied();
        }
        if (cancelled) throw iamAccountDenied();
      };
      const items: BatchRelayChannelUpstreamModelsResponse["items"] = new Array(data.ids.length);
      let cursor = 0;
      const worker = async () => {
        while (!cancelled && cursor < captured.configurations.length) {
          const index = cursor++,
            target = captured.configurations[index]!;
          if (!target.upstreamUrl || !target.apiKey) {
            items[index] = {
              channelId: target.id,
              channelName: target.name,
              status: "skipped",
              models: [],
              reasonKey: "relayChannel.upstreamConfigMissingForFormat",
            };
            continue;
          }
          try {
            const response = await query(data.format, target, {
              catalog: captured.snapshot.catalog,
              beforeSend: () => verify(target.id),
            });
            if (cancelled) throw iamAccountDenied();
            items[index] = {
              channelId: target.id,
              channelName: target.name,
              status: "success",
              models: response.models,
            };
          } catch (error) {
            if (cancelled) throw iamAccountDenied();
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            items[index] = {
              channelId: target.id,
              channelName: target.name,
              status: "failed",
              models: [],
              reasonKey: "relayChannel.upstreamModelListFailed",
              upstreamStatus:
                typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
                  ? status
                  : undefined,
            };
          }
        }
      };
      // Settle all already-started workers on revocation; none can publish a partial batch afterwards.
      const settled = await Promise.allSettled(
        Array.from({ length: Math.min(relayUpstreamModelsPolicy.concurrency, data.ids.length) }, worker),
      );
      if (cancelled || settled.some((result) => result.status === "rejected")) throw iamAccountDenied();
      await verify();
      return { format: data.format, items };
    };
    if (mode === "enforce") return native(true);
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelUpstreamModelIam", LogCategory.SECURITY).warn("Upstream model shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
