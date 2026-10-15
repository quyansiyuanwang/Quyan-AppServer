import { describe, expect, it, vi } from "vitest";
import {
  projectRelayAvailableModels,
  type RelayModelDiscoveryChannel,
  type RelayModelDiscoveryToken,
} from "@/services/relay/utils/relay-model-discovery.util";
import { RelayPoolResolverService, type RelayCapabilityGraphNode } from "@/services/relay/relay-pool-resolver.service";

const models = [
  { model: "A", provider: "model-a", supportedFormats: "openai" },
  { model: "B", provider: "model-b", supportedFormats: "anthropic" },
];
const channel = (overrides = {}) => ({ allowedFormats: "openai,anthropic", allowedModels: '["A", "B"]', ...overrides });
const project = (token: RelayModelDiscoveryToken = {}, channels: readonly RelayModelDiscoveryChannel[] = [channel()]) =>
  projectRelayAvailableModels(token, channels, models, "openai");
describe("credential-free model discovery", () => {
  it("requires only public model identity and channel constraints", () => {
    expect(project()).toEqual(["model-a"]);
  });
  it("does not dump the pricing catalog through an unrestricted channel", () => {
    expect(project({}, [channel({ allowedModels: null })])).toEqual([]);
  });
  it("honors token model restrictions and protocol independently", () => {
    expect(project({ allowedModels: '["model-b"]' })).toEqual([]);
    expect(project({}, [channel({ allowedFormats: "anthropic" })])).toEqual([]);
    expect(projectRelayAvailableModels({}, [channel()], models, "anthropic")).toEqual(["model-b"]);
  });
  it("accepts either display or provider identity in channel restrictions", () => {
    expect(project({}, [channel({ allowedModels: '["model-a"]' })])).toEqual(["model-a"]);
  });
  it("keeps channel aliases paired with their own available target", () => {
    expect(
      project({}, [
        channel({ allowedModels: '["A"]' }),
        channel({ allowedModels: '["B"]', modelMapping: { leak: "model-a" } }),
      ]),
    ).toEqual(["model-a"]);
  });
  it("includes token aliases only for an available provider or display target", () => {
    expect(project({ modelMapping: { alias: "model-a", display: "A", hidden: "model-b" } })).toEqual([
      "alias",
      "display",
      "model-a",
    ]);
  });
  it("ignores malformed mapping entries without interpreting them as executable expressions", () => {
    expect(project({ modelMapping: { bad: 10, empty: " ", good: " model-a " } })).toEqual(["good", "model-a"]);
  });
  it("does not let a mapping override the token allow-list", () => {
    expect(project({ allowedModels: '["model-b"]', modelMapping: { alias: "model-a" } })).toEqual([]);
  });
  it("deduplicates and sorts visible aliases and identities", () => {
    expect(project({ modelMapping: { z: "A", a: "A" } }, [channel(), channel()])).toEqual(["a", "model-a", "z"]);
  });
});

const node = (id: string, overrides: Partial<RelayCapabilityGraphNode> = {}): RelayCapabilityGraphNode => ({
  id,
  name: id,
  status: 1,
  providerServiceEnabled: true,
  channelType: "standalone",
  allowedFormats: "openai",
  allowedModels: null,
  modelMapping: null,
  routingConfig: null,
  poolMembers: [],
  ...overrides,
});
const member = (memberChannelId: string) => ({ memberChannelId, priority: 0, weight: 1, enabled: true });
function setup(nodes: RelayCapabilityGraphNode[]) {
  const repository = {
    listActive: vi.fn(() => {
      throw new Error("rich query forbidden");
    }),
    listVisible: vi.fn(),
  };
  const Ctor = RelayPoolResolverService as unknown as new (repository: unknown) => RelayPoolResolverService;
  return { resolver: new Ctor(repository), repository, graph: new Map(nodes.map((n) => [n.id, n])) };
}
describe("snapshot-only capability leaf resolution", () => {
  it("does not query the rich routing repository or combine distinct paths to the same leaf", async () => {
    const { resolver, repository, graph } = setup([
      node("root", { channelType: "automatic-proxy-pool", poolMembers: [member("a"), member("b")] }),
      node("a", {
        channelType: "pooled",
        allowedModels: '["A"]',
        modelMapping: { a: "model-a" },
        poolMembers: [member("leaf")],
      }),
      node("b", {
        channelType: "pooled",
        allowedModels: '["B"]',
        modelMapping: { b: "model-b" },
        poolMembers: [member("leaf")],
      }),
      node("leaf", { allowedFormats: "openai,anthropic" }),
    ]);
    const paths = await resolver.resolveCapabilityLeafCandidates(["root", "root"], graph);
    expect(paths.map((p) => p.routingChannelIds)).toEqual([
      ["root", "a", "leaf"],
      ["root", "b", "leaf"],
    ]);
    expect(paths.map((p) => p.resolvedChannel.modelMapping)).toEqual([{ a: "model-a" }, { b: "model-b" }]);
    expect(paths.map((p) => project({}, [p.resolvedChannel]))).toEqual([["a", "model-a"], []]);
    expect(repository.listActive).not.toHaveBeenCalled();
    expect(repository.listVisible).not.toHaveBeenCalled();
    expect(graph.get("leaf")!.allowedModels).toBeNull();
  });
  it.each([{ status: 0 }, { providerServiceEnabled: false }])("skips unavailable roots %j", async (override) => {
    const { resolver, graph } = setup([node("root", override)]);
    expect(await resolver.resolveCapabilityLeafCandidates(["root", "missing"], graph)).toEqual([]);
  });
  it("does not take a disabled member or recombine constraints from separate branches", async () => {
    const { resolver, graph } = setup([
      node("root", {
        channelType: "pooled",
        allowedModels: '["A"]',
        poolMembers: [member("leaf"), { ...member("off"), enabled: false }],
      }),
      node("leaf", { allowedModels: '["B"]' }),
      node("off", { allowedModels: '["A"]' }),
    ]);
    const paths = await resolver.resolveCapabilityLeafCandidates(["root"], graph);
    expect(paths).toHaveLength(1);
    expect(
      project(
        {},
        paths.map((p) => p.resolvedChannel),
      ),
    ).toEqual([]);
  });
  it("fails closed on a cycle instead of loading a fallback routing graph", async () => {
    const { resolver, graph, repository } = setup([
      node("root", { channelType: "pooled", poolMembers: [member("root")] }),
    ]);
    await expect(resolver.resolveCapabilityLeafCandidates(["root"], graph)).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.listActive).not.toHaveBeenCalled();
  });
});
