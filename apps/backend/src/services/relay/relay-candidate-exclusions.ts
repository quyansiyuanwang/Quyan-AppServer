import type { RelayResolvedChannelCandidate } from "./relay-pool-resolver.service";

/** Token exclusions refer to pool members, not necessarily the billable route root. */
export const filterBlockedAutomaticPoolCandidates = (
  candidates: RelayResolvedChannelCandidate[],
  blockedIds: unknown,
): RelayResolvedChannelCandidate[] => {
  const blocked = new Set(
    Array.isArray(blockedIds)
      ? blockedIds
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean)
      : [],
  );
  const seen = new Set<string>();
  return candidates.filter(({ resolvedChannel, billingChannel, routingChannelIds, routingKey }) => {
    if (
      blocked.has(resolvedChannel.id) ||
      (billingChannel && blocked.has(billingChannel.id)) ||
      routingChannelIds?.some((id) => blocked.has(id))
    )
      return false;
    // Distinct paths must survive until exclusions are checked, but the same
    // unblocked leaf/constraints should not receive duplicate attempts.
    if (routingKey) {
      if (seen.has(routingKey)) return false;
      seen.add(routingKey);
    }
    return true;
  });
};
