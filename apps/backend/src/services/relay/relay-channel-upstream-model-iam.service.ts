import { isDeepStrictEqual as same } from "node:util";
import type { Prisma } from "@prisma/client";
import axios from "axios";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestTransportConditionContext } from "@/iam/request/condition-context";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { RelayChannelUpstreamModelRepository } from "@/store/relay/relay-channel-upstream-model.repository";
import { assertIamAccountPrincipal, iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { PermissionService } from "../users/permission.service";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
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
} from "@/api/dto/relay/relay-channel.dto";
const action = "quyan:relay:BatchListUpstreamModels";
/** Separate batch admission, guarded sends and final disclosure; never hold database locks over HTTP. */
export class RelayChannelUpstreamModelIamService {
  private static instance: RelayChannelUpstreamModelIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelUpstreamModelIamService());
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
      const iam = IamAuthorizationService.getInstance(),
        repository = RelayChannelUpstreamModelRepository.getInstance(),
        identities = PlatformManagementReadRepository.getInstance(),
        snapshot = await identities.snapshot(principal, Permission.RELAY_CHANNEL_UPDATE),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
        keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId),
        transport = requestTransportConditionContext(request),
        resources = data.ids.map(platformRelayChannelArn);
      const assertRequest = () => {
        if (
          env.security.iamAuthorizationMode !== mode ||
          !same(getIamPrincipal(request), principal) ||
          request.accessKey?.id !== keyId ||
          request.oauthAccessToken ||
          !same(requestTransportConditionContext(request), transport)
        )
          throw iamAccountDenied();
      };
      const recheck = async (tx?: Prisma.TransactionClient, admittedResources: readonly string[] = resources) => {
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
        } else await identities.recheck(principal, Permission.RELAY_CHANNEL_UPDATE, snapshot);
        if (
          fingerprintIamPolicies(await iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId, tx)) !== keyRevision
        )
          throw iamAccountDenied();
        const decisions = await platformCollectionDecisions(iam, {
          principal,
          action,
          request,
          resources: admittedResources,
        });
        if (decisions.length !== admittedResources.length || decisions.some((decision) => decision !== "Allow"))
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck(); // No configuration, pricing catalog or credential read before full admission.
      if (!send) return { format: data.format, items: [] }; // Shadow must not read keys or probe twice.
      const guard = { principal, snapshot, recheck };
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
