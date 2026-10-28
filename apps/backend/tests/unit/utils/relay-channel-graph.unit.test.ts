import { describe, expect, it } from "vitest";
import { assertRelayChannelGraph } from "@/util/relay-channel-graph";
import { RELAY_CAPABILITY_RESOLUTION_LIMITS as limits } from "@/constant/relay-capability";
const check = (graph: Record<string, string[]>, roots = ["root"]) =>
  assertRelayChannelGraph(roots, (id) => {
    if (!Object.hasOwn(graph, id)) throw new Error("missing admitted node");
    return graph[id]!;
  });
const chain = (prefix: string, depth: number, leaf?: string) => {
  const graph: Record<string, string[]> = {};
  for (let index = 0; index <= depth; index++)
    graph[prefix + index] = index === depth ? (leaf ? [leaf] : []) : [prefix + (index + 1)];
  return graph;
};
describe("bounded admitted channel graph proof", () => {
  it("accepts empty graphs and shared subgraphs without rehydrating nodes", () => {
    check({}, []);
    check({ root: ["a", "b"], a: ["leaf"], b: ["leaf"], leaf: [] });
  });
  it.each(["self", "indirect"])("rejects %s cycles", (kind) => {
    const graph: Record<string, string[]> = kind === "self" ? { root: ["root"] } : { root: ["a"], a: ["root"] };
    expect(() => check(graph)).toThrow("Invalid channel graph");
  });
  it("preserves an exact-depth path but rejects one extra hop", () => {
    expect(() => check(chain("n", limits.poolDepth), ["n0"])).not.toThrow();
    expect(() => check(chain("n", limits.poolDepth + 1), ["n0"])).toThrow("Invalid channel graph");
  });
  it.each([false, true])("rejects a too-long alternate path independent of edge order (%s)", (reverse) => {
    const graph = {
      ...chain("tail", limits.poolDepth - 1),
      root: reverse ? ["middle", "tail0"] : ["tail0", "middle"],
      middle: ["tail0"],
    };
    expect(() => check(graph)).toThrow();
  });
  it("revalidates memoized height across independent operation roots", () => {
    const graph = { ...chain("tail", limits.poolDepth), root: ["tail0"] };
    expect(() => check(graph, ["tail0", "root"])).toThrow("Channel graph is too deep");
  });
  it("fails closed on a missing node rather than treating it as a leaf", () => {
    expect(() => check({ root: ["absent"] })).toThrow("missing admitted node");
  });
  it("bounds traversal even for many repeated edges to a memoized leaf", () => {
    expect(() => check({ root: Array.from({ length: limits.traversalVisits }, () => "leaf"), leaf: [] })).toThrow(
      "safe traversal limits",
    );
  });
});
