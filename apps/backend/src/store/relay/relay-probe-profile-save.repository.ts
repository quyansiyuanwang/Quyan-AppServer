import { Prisma } from "@prisma/client";
import { Permission } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeAccountArn,
  platformRelayProbeProfileArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { BadRequestError } from "@/util/errors";
import { mutatePlatformRelayProbe, type RelayProbeMutationContext } from "./platform-relay-probe-mutation";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { relayProbeReadTarget, relayProbeUpstreamConfigured } from "./relay-probe-read-target";
import { relayProbeProfileReadSelect, type RelayProbeProfileReadRecord } from "./relay-probe-profile-read.repository";
export interface RelayProbeProfileSaveMetadata {
  channelType: string;
  allowedFormats: string | null;
  allowedModels: string | null;
  upstreamConfigured: boolean;
  members: { id: string; active: boolean }[];
}
export class RelayProbeProfileSaveRepository {
  private static instance: RelayProbeProfileSaveRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeProfileSaveRepository());
  }
  async save<T>(
    channelId: string,
    reservedId: string,
    format: string,
    guard: RelayProbeMutationContext,
    prepare: (
      metadata: RelayProbeProfileSaveMetadata,
      previous: RelayProbeProfileReadRecord | undefined,
    ) => Omit<Prisma.RelayChannelProbeProfileUncheckedCreateInput, "id" | "relayChannelId">,
    map: (profile: RelayProbeProfileReadRecord) => T,
  ): Promise<T | undefined> {
    const { principal, snapshot, authorize, recheck, visible, persist } = guard,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    return mutatePlatformRelayProbe(
      Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      principal,
      snapshot,
      recheck,
      async (tx) => {
        await authorize([platformRelayChannelArn(channelId)]);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channels WHERE id = ${channelId} FOR UPDATE`);
        const { channel, members } = await relayProbeReadTarget(tx, channelId, undefined, visible);
        if (!["standalone", "pooled"].includes(channel.channelType))
          throw new BadRequestError("Unsupported probe target", undefined, {
            messageKey: "relayChannelProbe.balanceProbeScopeInvalid",
          });
        const identity = await tx.relayChannelProbeProfile.findUnique({
          where: { relayChannelId: channelId },
          select: { id: true, updateTime: true },
        });
        const profileId = identity?.id ?? reservedId;
        await authorize([platformRelayProbeProfileArn(channelId, profileId)]);
        const identifiers = [...members];
        for (let offset = 0; offset < identifiers.length; offset += limit)
          await authorize(identifiers.slice(offset, offset + limit).map(platformRelayChannelArn));
        if (identity) {
          let after: string | undefined;
          for (;;) {
            const targets: { id: string; targetChannelId: string; accountId: string | null }[] =
              await tx.relayChannelProbeTargetConfig.findMany({
                where: { profileId, ...(after ? { id: { gt: after } } : {}) },
                select: { id: true, targetChannelId: true, accountId: true },
                orderBy: { id: "asc" },
                take: limit,
              });
            if (!targets.length) break;
            await authorize([...new Set(targets.map((row) => row.targetChannelId))].map(platformRelayChannelArn));
            const accounts = [...new Set(targets.flatMap((row) => (row.accountId ? [row.accountId] : [])))];
            if (accounts.length) {
              const group = await platformManagementGroupSnapshot(
                principal,
                Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE,
                tx,
              );
              if (group.id !== snapshot.group.id || group.updateTime.getTime() !== snapshot.group.updateTime.getTime())
                throw iamAccountDenied();
              await guard.authorizeBoundProfileEdit(accounts.map(platformRelayProbeAccountArn));
            }
            after = targets[targets.length - 1]!.id;
            if (targets.length < limit) break;
          }
        }
        await recheck();
        // Shadow previews resource and binding authorization without reading/decrypting old credentials or encrypting new ones.
        if (!persist) return undefined;
        const settings = await tx.relayChannel.findUniqueOrThrow({
          where: { id: channelId },
          select: { allowedFormats: true, allowedModels: true },
        });
        const memberRows = identifiers.length
          ? await tx.relayChannel.findMany({
              where: { id: { in: identifiers } },
              select: { id: true, status: true, providerServiceEnabled: true, pooledMemberEnabled: true },
            })
          : [];
        const legacyEdges =
          channel.channelType === "pooled" && !(await tx.relayChannel.count({ where: { pooledParentId: channelId } }))
            ? await tx.relayChannelMember.findMany({
                where: { relayChannelId: channelId },
                select: { memberChannelId: true, enabled: true },
              })
            : [];
        const previous = identity
          ? await tx.relayChannelProbeProfile.findUnique({
              where: { id: profileId },
              select: relayProbeProfileReadSelect,
            })
          : undefined;
        if (
          identity &&
          (!previous ||
            previous.relayChannelId !== channelId ||
            previous.updateTime.getTime() !== identity.updateTime.getTime())
        )
          throw iamAccountDenied();
        const data = prepare(
          {
            channelType: channel.channelType,
            ...settings,
            upstreamConfigured: await relayProbeUpstreamConfigured(tx, channelId, format),
            members: memberRows.map((row) => ({
              id: row.id,
              active:
                row.status === RELAY_CHANNEL_STATUS.ENABLED &&
                row.providerServiceEnabled !== false &&
                row.pooledMemberEnabled !== false &&
                legacyEdges.find((edge) => edge.memberChannelId === row.id)?.enabled !== false,
            })),
          },
          previous ?? undefined,
        );
        await recheck();
        const record = identity
          ? await tx.relayChannelProbeProfile.update({
              where: { id: profileId, updateTime: identity.updateTime },
              data,
              select: relayProbeProfileReadSelect,
            })
          : await tx.relayChannelProbeProfile.create({
              data: { ...data, id: profileId, relayChannelId: channelId },
              select: relayProbeProfileReadSelect,
            });
        if (record.id !== profileId || record.relayChannelId !== channelId) throw iamAccountDenied();
        return map(record);
      },
    );
  }
}
