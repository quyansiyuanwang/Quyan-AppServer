import { Prisma } from "@prisma/client";
import { parseAllowedModelsJson, supportsRelayRequestFormat, type RelayRequestFormat } from "@quyan/shared";
import type {
  SaveRelayProbeConfigurationRequest,
  RelayChannelProbeTargetConfigDto,
} from "@/api/dto/relay/relay-channel-probe.dto";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeAccountArn,
  platformRelayProbeProfileArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { relayProbeReadTarget, relayProbeUpstreamConfigured } from "./relay-probe-read-target";
import type { RelayProbeMutationContext } from "./platform-relay-probe-mutation";
import type { RelayProbeProfileReadRecord } from "./relay-probe-profile-read.repository";
import { iamAccountDenied } from "../users/iam-account-principal";
import { BadRequestError, ConflictError, NotFoundError } from "@/util/errors";

export interface ProbeConfigurationGuards {
  profile: RelayProbeMutationContext;
  target?: RelayProbeMutationContext;
  binding?: RelayProbeMutationContext;
  unbind?: RelayProbeMutationContext;
}
export class RelayProbeConfigurationRepository {
  private static instance: RelayProbeConfigurationRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeConfigurationRepository());
  }
  /** Called inside the profile's identity-locked transaction. Any failure rolls back profile, credentials and binding together. */
  async saveTarget(
    tx: Prisma.TransactionClient,
    channelId: string,
    profile: RelayProbeProfileReadRecord,
    input: SaveRelayProbeConfigurationRequest,
    guards: ProbeConfigurationGuards,
  ): Promise<RelayChannelProbeTargetConfigDto | undefined> {
    const physicalId = input.memberChannelId ?? channelId;
    const { channel } = await relayProbeReadTarget(tx, channelId, input.memberChannelId, guards.profile.visible);
    if (channel.channelType === "pooled" && !input.memberChannelId) {
      if (input.target || input.accountId !== undefined) throw iamAccountDenied();
      return;
    }
    if (channel.channelType !== "pooled" && input.memberChannelId) throw iamAccountDenied();
    const metadata = await tx.relayChannelProbeTargetConfig.findUnique({
      where: { profileId_targetChannelId: { profileId: profile.id, targetChannelId: physicalId } },
    });
    if ((metadata?.updateTime.toISOString() ?? null) !== input.expectedTargetUpdatedAt)
      throw new ConflictError("Probe target configuration changed", undefined, { messageKey: "errors.conflict" });
    const resources = [
      platformRelayChannelArn(channelId),
      platformRelayProbeProfileArn(channelId, profile.id),
      ...(input.memberChannelId ? [platformRelayChannelArn(input.memberChannelId)] : []),
    ];
    if (input.target) {
      if (!guards.target) throw iamAccountDenied();
      await guards.target.authorize(resources);
      const settings = await tx.relayChannel.findUniqueOrThrow({
        where: { id: physicalId },
        select: { allowedFormats: true, allowedModels: true },
      });
      const format = input.target.probeFormat ?? metadata?.probeFormat ?? profile.probeFormat,
        model = input.target.probeModel ?? metadata?.probeModel ?? profile.probeModel;
      const models = parseAllowedModelsJson(settings.allowedModels) ?? [];
      if (
        !supportsRelayRequestFormat(settings.allowedFormats, format as RelayRequestFormat) ||
        (models.length && !models.includes(model)) ||
        !(await relayProbeUpstreamConfigured(tx, physicalId, format))
      )
        throw new BadRequestError("Invalid probe target settings", undefined, {
          messageKey: "relayChannelProbe.formatProbeUnsupported",
        });
    }
    if (input.accountId !== undefined) {
      if (!guards.binding) throw iamAccountDenied();
      await guards.binding.authorize([
        ...resources,
        ...(input.accountId ? [platformRelayProbeAccountArn(input.accountId)] : []),
      ]);
      if (metadata?.accountId && metadata.accountId !== input.accountId) {
        if (!guards.unbind) throw iamAccountDenied();
        await guards.unbind.authorize([...resources, platformRelayProbeAccountArn(metadata.accountId)]);
      }
      for (const id of [
        ...new Set([metadata?.accountId, input.accountId].filter((id): id is string => Boolean(id))),
      ].sort()) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channel_probe_accounts WHERE id = ${id} FOR UPDATE`);
        if (!(await tx.relayChannelProbeAccount.count({ where: { id } })))
          throw new NotFoundError("Probe account unavailable", undefined, {
            messageKey: "relayChannelProbe.accountNotFound",
          });
      }
    }
    if (!input.target && input.accountId === undefined)
      return metadata
        ? {
            channelId,
            memberChannelId: input.memberChannelId,
            accountId: metadata.accountId ?? undefined,
            probeFormat: (metadata.probeFormat as RelayChannelProbeTargetConfigDto["probeFormat"]) ?? undefined,
            probeModel: metadata.probeModel ?? undefined,
            probePayload: (metadata.probePayload as Record<string, unknown> | null) ?? undefined,
            probeGroup: metadata.probeGroup ?? undefined,
            updateTime: metadata.updateTime,
          }
        : undefined;
    const target = input.target ?? {};
    const { probePayload, ...targetSettings } = target;
    const data = {
      ...targetSettings,
      ...(probePayload !== undefined ? { probePayload: probePayload as Prisma.InputJsonValue } : {}),
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
    };
    const saved = await tx.relayChannelProbeTargetConfig.upsert({
      where: { profileId_targetChannelId: { profileId: profile.id, targetChannelId: physicalId } },
      create: { profileId: profile.id, targetChannelId: physicalId, ...data },
      update: data,
    });
    return {
      channelId,
      memberChannelId: input.memberChannelId,
      accountId: saved.accountId ?? undefined,
      probeFormat: (saved.probeFormat as RelayChannelProbeTargetConfigDto["probeFormat"]) ?? undefined,
      probeModel: saved.probeModel ?? undefined,
      probePayload: saved.probePayload as Record<string, unknown> | undefined,
      probeGroup: saved.probeGroup ?? undefined,
      updateTime: saved.updateTime,
    };
  }
}
