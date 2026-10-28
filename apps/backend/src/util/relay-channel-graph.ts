import { RELAY_CAPABILITY_RESOLUTION_LIMITS } from "@/constant/relay-capability";
import { BadRequestError } from "./errors";

/** Validate an admitted DAG without losing longer alternate paths behind a boolean visited cache.
 * The caller supplies only the edges relevant to its operation; missing admitted nodes must throw.
 * Disabled edges still participate: enabling them later must not expose a latent cycle.
 */
export function assertRelayChannelGraph(roots: readonly string[], edges: (id: string) => readonly string[]): void {
  const heights = new Map<string, number>(),
    visiting = new Set<string>();
  let remaining = RELAY_CAPABILITY_RESOLUTION_LIMITS.traversalVisits;
  const visit = (id: string, depth: number): number => {
    if (--remaining < 0)
      throw new BadRequestError("Channel graph exceeds safe traversal limits", undefined, {
        messageKey: "errors.badRequest",
      });
    if (visiting.has(id) || depth > RELAY_CAPABILITY_RESOLUTION_LIMITS.poolDepth)
      throw new BadRequestError("Invalid channel graph", undefined, { messageKey: "relay.poolCycle" });
    const known = heights.get(id);
    if (known !== undefined) {
      if (depth + known > RELAY_CAPABILITY_RESOLUTION_LIMITS.poolDepth)
        throw new BadRequestError("Channel graph is too deep", undefined, { messageKey: "relay.poolCycle" });
      return known;
    }
    visiting.add(id);
    let height = 0;
    for (const child of edges(id)) height = Math.max(height, 1 + visit(child, depth + 1));
    visiting.delete(id);
    heights.set(id, height);
    return height;
  };
  for (const root of roots) visit(root, 0);
}
