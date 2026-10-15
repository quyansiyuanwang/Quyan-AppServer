import { describe, expect, it, vi } from "vitest";
import {
  projectRelayCompositionCatalog,
  type RelayCompositionCatalogToken,
} from "@/services/relay/utils/relay-composition-catalog.util";
const token = (id: string, members: string[] = [], changes = {}): RelayCompositionCatalogToken => ({
  id,
  userId: "owner",
  status: 1,
  expiresAt: null,
  routingMode: members.length ? "composite" : "ordered",
  memberTokenConfigs: members.map((tokenId, priority) => ({ tokenId, priority, enabled: true })),
  ...changes,
});
const project = (
  nodes: RelayCompositionCatalogToken[],
  leaf = vi.fn().mockResolvedValue(["model-a"]),
  allows = vi.fn().mockResolvedValue(true),
) => projectRelayCompositionCatalog("root", "openai", new Map(nodes.map((node) => [node.id, node])), { leaf, allows });
describe("shared path-preserving composition catalog", () => {
  it("retains ordered real token paths without mixing sibling mappings", async () => {
    const nodes = [
      token("root", ["a", "b"]),
      token("a", ["leaf"], { modelMapping: { alpha: "model-a" } }),
      token("b", ["leaf"], { modelMapping: { beta: "model-b" } }),
      token("leaf"),
    ];
    expect(await project(nodes)).toEqual([
      { model: "model-a", tokenPathIds: ["root", "a", "leaf"] },
      { model: "alpha", tokenPathIds: ["root", "a", "leaf"] },
      { model: "model-a", tokenPathIds: ["root", "b", "leaf"] },
    ]);
  });
  it("passes only the actual ancestors to each leaf policy", async () => {
    const leaf = vi.fn().mockResolvedValue(["model-a"]),
      nodes = [token("root", ["a", "b"]), token("a"), token("b")];
    await project(nodes, leaf);
    expect(
      leaf.mock.calls.map(([node, , , ancestors]) => [
        node.id,
        ancestors.map((n: RelayCompositionCatalogToken) => n.id),
      ]),
    ).toEqual([
      ["a", ["root"]],
      ["b", ["root"]],
    ]);
  });
  it.each([{ status: 0 }, { expiresAt: new Date(0) }])(
    "does not call leaves through an unavailable root %j",
    async (overrides) => {
      const leaf = vi.fn();
      expect(await project([token("root", ["leaf"], overrides), token("leaf")], leaf)).toEqual([]);
      expect(leaf).not.toHaveBeenCalled();
    },
  );
  it("skips disabled, missing and cross-owner branches", async () => {
    const root = token("root", ["off", "missing", "foreign"]);
    root.memberTokenConfigs[0]!.enabled = false;
    const leaf = vi.fn();
    expect(await project([root, token("off"), token("foreign", [], { userId: "other" })], leaf)).toEqual([]);
    expect(leaf).not.toHaveBeenCalled();
  });
  it("does not turn an ancestor model restriction into another branch's capability", async () => {
    expect(
      await project(
        [token("root", ["leaf"]), token("leaf")],
        vi.fn().mockResolvedValue(["model-a"]),
        vi.fn().mockResolvedValue(false),
      ),
    ).toEqual([]);
  });
  it("bounds recursive cycles before exposing any leaf path", async () => {
    const leaf = vi.fn();
    expect(await project([token("root", ["child"]), token("child", ["root"])], leaf)).toEqual([]);
    expect(leaf).not.toHaveBeenCalled();
  });
});
