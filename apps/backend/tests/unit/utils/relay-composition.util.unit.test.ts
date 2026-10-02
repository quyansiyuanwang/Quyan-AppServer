import { describe, it, expect } from "vitest";
import { validateRelayComposition, type RelayCompositionNode } from "@/util/relay/relay-composition.util";
const node = (id: string, members: string[] = [], owner = "owner"): RelayCompositionNode => ({
  id,
  userId: owner,
  status: 1,
  routingMode: members.length ? "composite" : "ordered",
  memberTokenConfigs: members.map((tokenId, priority) => ({ tokenId, priority, enabled: true })),
});
describe("relay composition graph", () => {
  it("supports ordered nested DAGs with shared leaves", () => {
    expect(() =>
      validateRelayComposition([node("a", ["b", "c"]), node("b", ["d"]), node("c", ["d"]), node("d")]),
    ).not.toThrow();
  });
  it("rejects cross-owner members", () => {
    expect(() => validateRelayComposition([node("a", ["b"]), node("b", [], "other")])).toThrow();
  });
  it("rejects self-reference and cycles even on disabled edges", () => {
    expect(() => validateRelayComposition([node("a", ["a"])])).toThrow();
    const a = node("a", ["b"]);
    a.memberTokenConfigs[0].enabled = false;
    expect(() => validateRelayComposition([a, node("b", ["a"])])).toThrow();
  });
  it("validates all ancestors when a child grows beyond four levels", () => {
    const valid = [node("a", ["b"]), node("b", ["c"]), node("c", ["d"]), node("d", ["e"]), node("e")];
    expect(() => validateRelayComposition(valid)).not.toThrow();
    expect(() => validateRelayComposition([...valid.slice(0, 4), node("e", ["f"]), node("f")])).toThrow();
  });
  it("rejects duplicate members and priorities", () => {
    expect(() => validateRelayComposition([node("a", ["b", "b"]), node("b")])).toThrow();
    const a = node("a", ["b", "c"]);
    a.memberTokenConfigs[1].priority = 0;
    expect(() => validateRelayComposition([a, node("b"), node("c")])).toThrow();
  });
  it("bounds expanded paths rather than distinct leaves", () => {
    const children = Array.from({ length: 11 }, (_, index) =>
      node(
        `b${index}`,
        Array.from({ length: 10 }, (_, j) => `c${j}`),
      ),
    );
    const leaves = Array.from({ length: 10 }, (_, index) => node(`c${index}`));
    expect(() =>
      validateRelayComposition([
        node(
          "a",
          children.map((item) => item.id),
        ),
        ...children,
        ...leaves,
      ]),
    ).toThrow();
  });
  it("retains deleted member references without executing their old graph", () => {
    const removed = node("b", ["a"]);
    removed.status = -1;
    expect(() => validateRelayComposition([node("a", ["b"]), removed])).not.toThrow();
  });
});
