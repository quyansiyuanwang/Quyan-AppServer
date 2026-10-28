import type { Prisma, RelayChannel } from "@prisma/client";

export interface EffectiveRelayPoolMember<TChannel = RelayChannel> {
  memberChannelId: string;
  priority: number;
  weight: Prisma.Decimal | number;
  enabled: boolean;
  memberChannel?: TChannel | null;
}

type RelayChannelWithPoolRelations<TChannel> = TChannel & {
  poolMembers?: Array<{
    memberChannelId: string;
    priority: number;
    weight: Prisma.Decimal | number;
    enabled: boolean;
    memberChannel?: TChannel | null;
  }>;
  pooledChildren?: (TChannel & Pick<RelayChannel, "id" | "pooledPriority" | "pooledWeight" | "pooledMemberEnabled">)[];
};

/**
 * Presents legacy join-table members and strict pooled children as one stable
 * member set. A strict child owns its member settings when both relations name
 * the same channel.
 */
export function resolveEffectiveRelayPoolMembers<TChannel extends Pick<RelayChannel, "id" | "channelType">>(
  channel: RelayChannelWithPoolRelations<TChannel>,
): EffectiveRelayPoolMember<TChannel>[] {
  const withRelations = channel;
  const members = new Map<string, EffectiveRelayPoolMember<TChannel>>();

  for (const member of withRelations.poolMembers ?? []) {
    members.set(member.memberChannelId, {
      memberChannelId: member.memberChannelId,
      priority: member.priority,
      weight: member.weight,
      enabled: member.enabled,
      memberChannel: member.memberChannel ?? null,
    });
  }

  if (channel.channelType === "pooled") {
    for (const child of withRelations.pooledChildren ?? []) {
      members.set(child.id, {
        memberChannelId: child.id,
        priority: child.pooledPriority,
        weight: child.pooledWeight,
        enabled: child.pooledMemberEnabled,
        memberChannel: child,
      });
    }
  }

  return [...members.values()].sort(
    (left, right) => left.priority - right.priority || left.memberChannelId.localeCompare(right.memberChannelId),
  );
}
