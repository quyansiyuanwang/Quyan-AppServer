import { BadRequestError } from "@/util/errors";

/** Disabled edges are validated too: enabling a member must not create an invalid graph. */
export const RELAY_COMPOSITION_POLICY = Object.freeze({
  maxDepth: 4,
  maxMembers: 20,
  maxLeafPaths: 100,
  maxUpstreamAttempts: 100,
  retryStatusCodes: ["408", "429", "500", "502", "503", "504"],
});
export interface RelayCompositionMember {
  tokenId: string;
  priority: number;
  enabled: boolean;
}
export interface RelayCompositionNode {
  id: string;
  userId: string;
  routingMode: string;
  status: number;
  memberTokenConfigs: RelayCompositionMember[];
}
export const compositionError = (reason: "invalidMember" | "cycle" | "depth" | "size" | "mode") =>
  new BadRequestError(`Invalid relay composition: ${reason}`, undefined, {
    messageKey: (
      {
        invalidMember: "relayToken.compositionInvalidMember",
        cycle: "relayToken.compositionCycle",
        depth: "relayToken.compositionDepth",
        size: "relayToken.compositionSize",
        mode: "relayToken.compositionMode",
      } as const
    )[reason],
  });

export function validateRelayComposition(nodes: RelayCompositionNode[]): void {
  const graph = new Map(nodes.map((node) => [node.id, node]));
  for (const root of nodes) {
    if (root.routingMode !== "composite" || root.status === -1) continue;
    let leaves = 0;
    const visit = (node: RelayCompositionNode, path: Set<string>, depth: number) => {
      if (path.has(node.id)) throw compositionError("cycle");
      if (node.routingMode !== "composite") {
        if (++leaves > RELAY_COMPOSITION_POLICY.maxLeafPaths) throw compositionError("size");
        return;
      }
      if (++depth > RELAY_COMPOSITION_POLICY.maxDepth) throw compositionError("depth");
      if (!node.memberTokenConfigs.length || node.memberTokenConfigs.length > RELAY_COMPOSITION_POLICY.maxMembers)
        throw compositionError("size");
      const ids = new Set<string>();
      const priorities = new Set<number>();
      const next = new Set(path).add(node.id);
      for (const edge of node.memberTokenConfigs) {
        const member = graph.get(edge.tokenId);
        if (!member || member.userId !== root.userId || ids.has(edge.tokenId) || priorities.has(edge.priority))
          throw compositionError("invalidMember");
        ids.add(edge.tokenId);
        priorities.add(edge.priority);
        if (member.status === -1) continue;
        visit(member, next, depth);
      }
    };
    visit(root, new Set(), 0);
  }
}
