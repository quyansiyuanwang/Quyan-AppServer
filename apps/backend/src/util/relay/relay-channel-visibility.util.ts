import type { RelayChannel } from "@prisma/client";
export function normalizeRelayChannelVisibilityConfig(input: unknown) {
  const config = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const ids = (key: string) =>
    Array.isArray(config[key]) ? config[key].filter((id): id is string => typeof id === "string" && Boolean(id)) : [];
  return { userIds: ids("userIds"), groupIds: ids("groupIds"), roleIds: ids("roleIds") };
}
/** Business visibility is distinct from IAM authority. The caller must separately prove any management bypass. */
export function isRelayChannelVisible(
  channel: Pick<RelayChannel, "visibilityMode" | "visibilityConfig">,
  actor: { id: string; groupId?: string | null; roleIds: readonly string[] },
): boolean {
  const mode = channel.visibilityMode ?? "public";
  if (mode === "public") return true;
  if (mode !== "whitelist") return false;
  const config = normalizeRelayChannelVisibilityConfig(channel.visibilityConfig);
  return (
    config.userIds.includes(actor.id) ||
    Boolean(actor.groupId && config.groupIds.includes(actor.groupId)) ||
    actor.roleIds.some((id) => config.roleIds.includes(id))
  );
}
