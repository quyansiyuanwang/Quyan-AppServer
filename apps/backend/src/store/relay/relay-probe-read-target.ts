import type { Prisma } from "@prisma/client";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import type { ProbeChannelVisibilityRecord } from "./relay-probe-latest-run-read.repository";
import { iamAccountDenied } from "../users/iam-account-principal";
export async function relayProbeReadTarget(
  tx: Prisma.TransactionClient,
  channelId: string,
  memberChannelId: string | undefined,
  visible: (channel: ProbeChannelVisibilityRecord) => Promise<boolean>,
) {
  const channel = await tx.relayChannel.findFirst({
    where: { id: channelId, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
    select: { id: true, channelType: true, visibilityMode: true, visibilityConfig: true },
  });
  if (!channel || !(await visible(channel))) throw iamAccountDenied();
  const members = new Set<string>();
  if (channel.channelType === "pooled") {
    const strict = await tx.relayChannel.findMany({
      where: { pooledParentId: channelId },
      select: { id: true, status: true },
    });
    if (strict.length)
      strict
        .filter((row) => VISIBLE_RELAY_CHANNEL_STATUSES.some((status) => status === row.status))
        .forEach((row) => members.add(row.id));
    else {
      const edges = await tx.relayChannelMember.findMany({
        where: { relayChannelId: channelId, memberChannel: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } } },
        select: { memberChannelId: true },
      });
      edges.forEach((row) => members.add(row.memberChannelId));
    }
  }
  if (memberChannelId && !members.has(memberChannelId)) throw iamAccountDenied();
  return { channel, members };
}
