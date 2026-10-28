import type { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import type { RelayProbeRunAdmission } from "@/services/relay/relay-probe-run-admission";
import { iamAccountDenied } from "../users/iam-account-principal";
export class RelayProbeRunExecutionRepository {
  private static instance: RelayProbeRunExecutionRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeRunExecutionRepository());
  }
  async inspect(runId: string, owner: string, expected?: RelayProbeRunAdmission) {
    const run = await prisma.relayChannelProbeRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        relayChannelId: true,
        probeMemberChannelId: true,
        profileId: true,
        requestedByUserId: true,
        status: true,
        leaseOwner: true,
        leaseExpiresAt: true,
      },
    });
    if (
      !run ||
      run.status !== "running" ||
      run.leaseOwner !== owner ||
      !run.leaseExpiresAt ||
      run.leaseExpiresAt.getTime() <= Date.now()
    )
      throw iamAccountDenied();
    if (!expected) return;
    if (
      run.id !== expected.runId ||
      run.relayChannelId !== expected.channelId ||
      run.probeMemberChannelId !== expected.memberChannelId ||
      run.profileId !== expected.profileId ||
      run.requestedByUserId !== expected.principal.subjectUserId
    )
      throw iamAccountDenied();
    const channels = await prisma.relayChannel.findMany({
      where: {
        id: { in: [expected.channelId, expected.memberChannelId ?? expected.channelId] },
        status: { in: VISIBLE_RELAY_CHANNEL_STATUSES },
      },
      select: {
        id: true,
        channelType: true,
        status: true,
        providerServiceEnabled: true,
        pooledMemberEnabled: true,
        pooledParentId: true,
        visibilityMode: true,
        visibilityConfig: true,
      },
    });
    const parent = channels.find((row) => row.id === expected.channelId),
      target = channels.find((row) => row.id === (expected.memberChannelId ?? expected.channelId));
    if (
      !parent ||
      !target ||
      target.status !== RELAY_CHANNEL_STATUS.ENABLED ||
      target.providerServiceEnabled === false ||
      target.pooledMemberEnabled === false
    )
      throw iamAccountDenied();
    if (expected.memberChannelId) {
      if (parent.channelType !== "pooled") throw iamAccountDenied();
      const strict = await prisma.relayChannel.count({ where: { pooledParentId: parent.id } });
      if (
        strict
          ? target.pooledParentId !== parent.id
          : !(await prisma.relayChannelMember.count({
              where: { relayChannelId: parent.id, memberChannelId: target.id, enabled: true },
            }))
      )
        throw iamAccountDenied();
    } else if (parent.channelType !== "standalone") throw iamAccountDenied();
    const profile = await prisma.relayChannelProbeProfile.findUnique({
      where: { id: expected.profileId },
      select: { id: true, relayChannelId: true, enabled: true, updateTime: true },
    });
    const config = await prisma.relayChannelProbeTargetConfig.findUnique({
      where: {
        profileId_targetChannelId: {
          profileId: expected.profileId,
          targetChannelId: expected.memberChannelId ?? expected.channelId,
        },
      },
      select: { id: true, accountId: true, updateTime: true },
    });
    if (
      !profile ||
      !profile.enabled ||
      profile.relayChannelId !== parent.id ||
      profile.updateTime.toISOString() !== expected.profileUpdatedAt ||
      (config?.id ?? null) !== expected.targetConfigId ||
      (config?.accountId ?? null) !== expected.accountId ||
      (config?.updateTime.toISOString() ?? null) !== expected.targetConfigUpdatedAt
    )
      throw iamAccountDenied();
    return parent satisfies Pick<
      Prisma.RelayChannelGetPayload<Record<string, never>>,
      "visibilityMode" | "visibilityConfig"
    >;
  }
}
