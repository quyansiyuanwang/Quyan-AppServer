import { describe, expect, it, vi } from "vitest";
import { matchesModelPattern, resolveMappedModel } from "@quyan/shared";
import {
  catalogModelCapabilities,
  catalogModelMappings,
  projectRelayChannelCatalog,
} from "@/services/relay/relay-channel-catalog-projection";
import {
  RelayPoolResolverService,
  type RelayCapabilityGraphNode,
  type RelayChannelModelCapability,
} from "@/services/relay/relay-pool-resolver.service";
import type { RelayCatalogSnapshot } from "@/store/relay/relay-channel-catalog-read.repository";

vi.mock("@/store/relay/relay-channel.repository", () => ({
  RelayChannelRepository: { getInstance: () => ({}) },
}));

const capability = (changes: Partial<RelayChannelModelCapability> = {}): RelayChannelModelCapability => ({
  leafChannelId: "private-leaf",
  catalogModelName: "Model A",
  requestModelId: "model-a",
  supportedRequestFormats: ["openai-chat-completions"],
  modelMapping: {},
  ...changes,
});
const node = (id: string, changes: Partial<RelayCapabilityGraphNode> = {}): RelayCapabilityGraphNode => ({
  id,
  name: id,
  status: 1,
  providerServiceEnabled: true,
  channelType: "standalone",
  allowedFormats: null,
  allowedModels: null,
  routingConfig: { allowedModelsMode: "all" },
  modelMapping: null,
  poolMembers: [],
  ...changes,
});
const members = (...ids: string[]) =>
  ids.map((memberChannelId, priority) => ({ memberChannelId, priority, weight: 1, enabled: true }));

describe("catalogModelMappings", () => {
  it("skips malformed historical targets while retaining their higher-priority exclusions", () => {
    const mapping = { "alias*": "model-a", "alias-broken": null, "alias-4*": 7 } as unknown as Record<string, string>;
    expect(catalogModelMappings([capability({ modelMapping: mapping })])).toEqual([
      {
        requestModelPattern: "alias*",
        catalogModelName: "Model A",
        billingModelId: "model-a",
        supportedRequestFormats: ["openai-chat-completions"],
        excludedRequestModelPatterns: ["alias-4*", "alias-broken"],
      },
    ]);
  });
  it("publishes request IDs with trimmed targets and retains identity rules", () => {
    expect(
      catalogModelMappings([
        capability({
          modelMapping: {
            alias: " model-a ",
            "model-a": "model-a",
            displayOnly: "Model A",
            missing: "model-b",
            caseMismatch: "MODEL-A",
            blank: " ",
          },
        }),
      ]),
    ).toEqual([
      {
        requestModelPattern: "alias",
        catalogModelName: "Model A",
        billingModelId: "model-a",
        supportedRequestFormats: ["openai-chat-completions"],
      },
      {
        requestModelPattern: "model-a",
        catalogModelName: "Model A",
        billingModelId: "model-a",
        supportedRequestFormats: ["openai-chat-completions"],
      },
    ]);
  });

  it("excludes exact and more specific rules even when their targets are unavailable", () => {
    const mapping = {
      "gpt-*": "model-a",
      "gpt-4*": "missing",
      "gpt-4o": "Model A",
      unrelated: "missing",
      "gpt-?": "missing",
    };
    const [row] = catalogModelMappings([capability({ modelMapping: mapping })]);
    expect(row).toMatchObject({
      requestModelPattern: "gpt-*",
      excludedRequestModelPatterns: ["gpt-4*", "gpt-4o", "unrelated"],
    });
    for (const requested of ["gpt-4o", "gpt-4x", "gpt-5", "gpt-new", "GPT-new"]) {
      const matches =
        matchesModelPattern(requested, row.requestModelPattern) &&
        !row.excludedRequestModelPatterns?.some((pattern) => matchesModelPattern(requested, pattern));
      expect(matches, requested).toBe(resolveMappedModel(requested, mapping).trim() === "model-a");
    }
  });

  it("retains overlapping wildcard insertion ties before output sorting", () => {
    const rows = catalogModelMappings([
      capability({ modelMapping: { "z*": "missing", "*a": "model-a", "*": "model-a" } }),
    ]);
    expect(rows.find((row) => row.requestModelPattern === "*a")).toMatchObject({
      excludedRequestModelPatterns: ["z*"],
    });
    expect(rows.find((row) => row.requestModelPattern === "*")).toMatchObject({
      excludedRequestModelPatterns: ["*a", "z*"],
    });
  });

  it("merges formats only for identical catalog, billing ID, pattern and exclusions", () => {
    const rows = catalogModelMappings([
      capability({ modelMapping: { "alias*": "model-a" }, supportedRequestFormats: ["anthropic", "anthropic"] }),
      capability({ leafChannelId: "other-leaf", modelMapping: { "alias*": "model-a" } }),
      capability({
        modelMapping: { "alias*": "model-a", "alias-blocked": "missing" },
        supportedRequestFormats: ["gemini"],
      }),
      capability({ catalogModelName: "Other display", modelMapping: { "alias*": "model-a" } }),
      capability({ requestModelId: "model-b", modelMapping: { "alias*": "model-b" } }),
      capability({ modelMapping: { denied: "model-a" }, supportedRequestFormats: [] }),
    ]);
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.catalogModelName === "Model A" && row.billingModelId === "model-a")).toEqual(
      expect.arrayContaining([
        {
          requestModelPattern: "alias*",
          catalogModelName: "Model A",
          billingModelId: "model-a",
          supportedRequestFormats: ["openai-chat-completions", "anthropic"],
        },
        {
          requestModelPattern: "alias*",
          catalogModelName: "Model A",
          billingModelId: "model-a",
          supportedRequestFormats: ["gemini"],
          excludedRequestModelPatterns: ["alias-blocked"],
        },
      ]),
    );
  });

  it("deduplicates canonical exclusions and sorts output without mutating capabilities", () => {
    const input = [
      capability({
        modelMapping: { "*": "model-a", z: "missing", a: "missing" },
        supportedRequestFormats: ["gemini", "anthropic"],
      }),
      capability({ modelMapping: { a: "missing", z: "missing", "*": "model-a" } }),
    ];
    const before = JSON.stringify(input);
    const rows = catalogModelMappings(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      excludedRequestModelPatterns: ["a", "z"],
      supportedRequestFormats: ["openai-chat-completions", "anthropic", "gemini"],
    });
    expect(catalogModelMappings([...input].reverse())).toEqual(rows);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(rows)).not.toMatch(/private-leaf|leafChannelId|modelMapping|routingChannelIds/);
  });
});

describe("catalog mappings from intact graph paths", () => {
  it("preserves two routes to the same leaf and retains existing default aggregation", async () => {
    const nodes = [
      node("root", { channelType: "automatic-proxy-pool", poolMembers: members("path-a", "path-b") }),
      node("path-a", {
        channelType: "pooled",
        modelMapping: { "z*": "missing", "*a": "model-a" },
        poolMembers: members("leaf"),
      }),
      node("path-b", {
        channelType: "pooled",
        modelMapping: { "*a": "model-a", "z*": "missing" },
        poolMembers: members("leaf"),
      }),
      node("leaf", { channelType: "pooled-member", allowedFormats: "anthropic" }),
    ];
    const context = {
      graph: new Map(nodes.map((row) => [row.id, row])),
      modelCatalog: [{ model: "Model A", provider: "model-a", supportedFormats: "openai,anthropic" }],
    };
    const resolver = RelayPoolResolverService.getInstance();
    const defaults = await resolver.resolveChannelCapabilities("root", context);
    const intact = await resolver.resolveChannelCapabilities("root", context, { preserveModelMappingPaths: true });
    expect(defaults).toHaveLength(1);
    expect(intact).toHaveLength(2);
    expect(catalogModelMappings(intact)).toHaveLength(2);
    expect(catalogModelCapabilities(intact)).toEqual(catalogModelCapabilities(defaults));
    expect(catalogModelMappings(intact)).toEqual(
      expect.arrayContaining([
        {
          requestModelPattern: "*a",
          catalogModelName: "Model A",
          billingModelId: "model-a",
          supportedRequestFormats: ["anthropic"],
        },
        {
          requestModelPattern: "*a",
          catalogModelName: "Model A",
          billingModelId: "model-a",
          supportedRequestFormats: ["anthropic"],
          excludedRequestModelPatterns: ["z*"],
        },
      ]),
    );
    expect(catalogModelMappings([...intact].reverse())).toEqual(catalogModelMappings(intact));
    const snapshot = {
      sources: nodes.map((row) => ({ ...row, multiplier: 1 })),
      context,
      poolVisibility: "anonymous-range",
    } as unknown as RelayCatalogSnapshot;
    const [row] = await projectRelayChannelCatalog(snapshot);
    expect(row.modelMappings).toEqual(catalogModelMappings(intact));
    expect(JSON.stringify(row)).not.toMatch(/path-a|path-b|leaf|poolMembers|modelMapping"/);
  });

  it("intersects root and leaf whitelists, applies leaf overrides, and restricts formats", async () => {
    const nodes = [
      node("root", {
        channelType: "pooled",
        allowedModels: '["Model A", "Root only"]',
        routingConfig: { allowedModelsMode: "manual" },
        modelMapping: { "alias*": "model-a", override: "missing", denied: "root-only" },
        poolMembers: members("leaf"),
      }),
      node("leaf", {
        allowedFormats: "anthropic",
        allowedModels: '["Model A", "Leaf only"]',
        routingConfig: { allowedModelsMode: "manual" },
        modelMapping: { override: "model-a", deniedLeaf: "leaf-only", "alias-blocked": "missing" },
      }),
    ];
    const modelCatalog = [
      { model: "Model A", provider: "model-a", supportedFormats: "openai,anthropic" },
      { model: "Root only", provider: "root-only", supportedFormats: "anthropic" },
      { model: "Leaf only", provider: "leaf-only", supportedFormats: "anthropic" },
    ];
    const caps = await RelayPoolResolverService.getInstance().resolveChannelCapabilities(
      "root",
      { graph: new Map(nodes.map((row) => [row.id, row])), modelCatalog },
      { preserveModelMappingPaths: true },
    );
    expect(caps).toHaveLength(1);
    const rows = catalogModelMappings(caps);
    expect(rows.map((row) => row.requestModelPattern)).toEqual(["alias*", "override"]);
    expect(
      rows.every((row) => row.billingModelId === "model-a" && row.supportedRequestFormats.join() === "anthropic"),
    ).toBe(true);
    expect(rows[0].excludedRequestModelPatterns).toEqual(["alias-blocked", "denied", "deniedLeaf", "override"]);
    expect(rows[1].excludedRequestModelPatterns).toBeUndefined();
  });
});
