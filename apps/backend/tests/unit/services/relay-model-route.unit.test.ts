import { describe, expect, it, vi } from "vitest";
import type { RelayRequestFormat, RelayTokenModelMappingPreference, RelayTokenModelMappingRule } from "@quyan/shared";
import {
  relayModelRouteRequestCandidates,
  resolveRelayModelRoute,
  type RelayModelRouteChannel,
  type RelayModelRouteToken,
} from "@/services/relay/utils/relay-model-route.util";

// Format-rule selection is real; resource settings used by HTTP/stream transforms
// are outside this pure resolver's boundary and must never be read here.
vi.mock("@/services/infrastructure/ai-resource-config.service", () => ({
  getAIResourceConfig: () => {
    throw new Error("Route resolution must not read infrastructure settings");
  },
}));

const CHAT = "openai-chat-completions" as const;
const catalog: Array<{ model: string; provider: string; supportedFormats: string }> = [
  { model: "Display A", provider: "A", supportedFormats: CHAT },
  { model: "Display B", provider: "B", supportedFormats: CHAT },
  { model: "Display C", provider: "C", supportedFormats: CHAT },
];
const mapping = (
  source = "B",
  target = "A",
  preference: RelayTokenModelMappingPreference = "mapping-first",
  channelIds?: string[],
): RelayTokenModelMappingRule => ({ source, target, preference, ...(channelIds ? { channelIds } : {}) });
const token = (overrides: Partial<RelayModelRouteToken> = {}): RelayModelRouteToken => ({
  id: "token",
  modelMappingRules: [mapping()],
  ...overrides,
});
const channel = (ids: string[], overrides: Partial<RelayModelRouteChannel> = {}): RelayModelRouteChannel => ({
  id: "leaf",
  allowedModels: JSON.stringify(ids),
  allowedFormats: CHAT,
  multiplier: 1,
  ...overrides,
});
const resolve = (
  tokens: readonly RelayModelRouteToken[],
  routeChannel: RelayModelRouteChannel,
  overrides: Partial<Parameters<typeof resolveRelayModelRoute<(typeof catalog)[number]>>[0]> = {},
) =>
  resolveRelayModelRoute({
    requestedModel: "B",
    requestFormat: CHAT,
    tokens,
    channel: routeChannel,
    modelCatalog: catalog,
    ...overrides,
  });

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

describe("route-local B -> A model preference", () => {
  it.each([
    ["mapping-first", ["A"], "A", "mapped"],
    ["mapping-first", ["B"], "B", "fallback"],
    ["mapping-first", ["A", "B"], "A", "mapped"],
    ["mapping-first", [], undefined, "unavailable"],
    ["original-first", ["A"], "A", "mapped"],
    ["original-first", ["B"], "B", "original"],
    ["original-first", ["A", "B"], "B", "original"],
    ["original-first", [], undefined, "unavailable"],
  ] as const)("%s with channel models %j selects %s (%s)", (preference, ids, expected, outcome) => {
    const result = resolve([token({ modelMappingRules: [mapping("B", "A", preference)] })], channel([...ids]));
    expect(result.effectiveModel).toBe(expected);
    expect(result.modelConfig?.provider).toBe(expected);
    expect(result.outcome).toBe(outcome);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ inputModel: "B", sourceFormat: CHAT, targetFormat: CHAT });
    if (!expected) expect(result.reason).toBe("model-unavailable");
  });

  it.each(["mapping-first", "original-first"] as const)(
    "does not borrow availability from a sibling route (%s)",
    (preference) => {
      const tokens = [token({ modelMappingRules: [mapping("B", "A", preference)] })];
      const aOnly = resolve(tokens, channel(["A"], { id: "a-only" }));
      const bOnly = resolve(tokens, channel(["B"], { id: "b-only" }));
      const neither = resolve(tokens, channel([], { id: "neither" }));
      expect(aOnly.effectiveModel).toBe("A");
      expect(bOnly.effectiveModel).toBe("B");
      expect(neither.modelConfig).toBeNull();
      expect(neither.outcome).toBe("unavailable");
    },
  );

  it("applies same-source rules with disjoint channel scopes on their own route", () => {
    const tokens = [
      token({
        modelMappingRules: [
          mapping("B", "A", "mapping-first", ["left"]),
          mapping("B", "C", "mapping-first", ["right"]),
        ],
      }),
    ];
    const leaf = channel(["A", "B", "C"]);
    expect(resolve(tokens, leaf, { channelPathIds: ["root", "left", "leaf"] }).effectiveModel).toBe("A");
    expect(resolve(tokens, leaf, { channelPathIds: ["root", "right", "leaf"] }).effectiveModel).toBe("C");
    expect(resolve(tokens, leaf, { channelPathIds: ["root", "other", "leaf"] }).effectiveModel).toBe("B");
  });

  it("uses explicit path, then channel routing path, then leaf ID for scope", () => {
    const tokens = [token({ modelMappingRules: [mapping("B", "A", "mapping-first", ["parent"])] })];
    const leaf = channel(["A", "B"], { routingChannelIds: ["parent", "leaf"] });
    expect(resolve(tokens, leaf).effectiveModel).toBe("A");
    expect(resolve(tokens, leaf, { channelPathIds: ["other", "leaf"] }).effectiveModel).toBe("B");
    expect(resolve(tokens, channel(["A", "B"], { id: "parent" })).effectiveModel).toBe("A");
  });
});

describe("token whitelist is evaluated against the resolved route", () => {
  it.each(["mapping-first", "original-first"] as const)(
    "allows alias-only whitelist on either viable route (%s)",
    (preference) => {
      const tokens = [token({ allowedModels: "B", modelMappingRules: [mapping("B", "A", preference)] })];
      expect(resolve(tokens, channel(["A"])).effectiveModel).toBe("A");
      expect(resolve(tokens, channel(["B"])).effectiveModel).toBe("B");
    },
  );

  it.each(["mapping-first", "original-first"] as const)(
    "allows target-only whitelist only on the route that resolves that target (%s)",
    (preference) => {
      const tokens = [token({ allowedModels: "A", modelMappingRules: [mapping("B", "A", preference)] })];
      expect(resolve(tokens, channel(["A"])).effectiveModel).toBe("A");
      expect(resolve(tokens, channel(["B"]))).toMatchObject({
        modelConfig: null,
        outcome: "unavailable",
        reason: "model-not-allowed",
      });
    },
  );

  it("does not authorize a denied model with an unused mapping target", () => {
    const result = resolve([token({ allowedModels: "C" })], channel(["A", "B", "C"]));
    expect(result).toMatchObject({ modelConfig: null, outcome: "unavailable", reason: "model-not-allowed" });
  });

  it("does not retry its mapped branch when its own whitelist denies the selected original-first branch", () => {
    const result = resolve(
      [token({ allowedModels: "A", modelMappingRules: [mapping("B", "A", "original-first")] })],
      channel(["A", "B"]),
    );
    expect(result).toMatchObject({ modelConfig: null, outcome: "unavailable", reason: "model-not-allowed" });
    expect(result.steps[0]).toMatchObject({ inputModel: "B", outputModel: "B", fallback: false });
  });

  it("does not retry channel fallback when its own whitelist denies the selected mapping-first branch", () => {
    const result = resolve([token({ allowedModels: "C" })], channel(["A", "C"], { modelMapping: { B: "C" } }));
    expect(result).toMatchObject({ modelConfig: null, outcome: "unavailable", reason: "model-not-allowed" });
    expect(result.steps[0]).toMatchObject({ inputModel: "B", outputModel: "A", fallback: false });
  });

  it.each(["leaf", "outer"] as const)(
    "does not borrow another provider's whitelist permission through a duplicate display label at the %s token",
    (layer) => {
      const label = "Shared display label";
      const modelCatalog = [
        { model: label, provider: "provider-X", supportedFormats: CHAT },
        { model: label, provider: "provider-Y", supportedFormats: CHAT },
      ];
      const mapped = token({
        id: layer,
        allowedModels: "provider-X",
        modelMappingRules: [mapping("B", label)],
      });
      const tokens = layer === "outer" ? [mapped, token({ id: "member", modelMappingRules: [] })] : [mapped];
      const route = channel(["provider-Y"]);
      const before = structuredClone({ tokens, route, modelCatalog });

      // Prove the route selects Y even though the colliding X row appears first.
      const unrestricted = resolve(
        tokens.map((entry) => ({ ...entry, allowedModels: null })),
        route,
        { modelCatalog },
      );
      expect(unrestricted.modelConfig).toBe(modelCatalog[1]);
      expect(unrestricted.effectiveModel).toBe("provider-Y");

      const denied = resolve(tokens, route, { modelCatalog });
      expect(denied).toMatchObject({ modelConfig: null, outcome: "unavailable", reason: "model-not-allowed" });

      // Permission for the actual selected provider remains valid at either layer.
      const allowed = resolve(
        tokens.map((entry) => (entry.id === layer ? { ...entry, allowedModels: "provider-Y" } : entry)),
        route,
        { modelCatalog },
      );
      expect(allowed.modelConfig).toBe(modelCatalog[1]);
      expect(allowed.effectiveModel).toBe("provider-Y");
      expect({ tokens, route, modelCatalog }).toEqual(before);
    },
  );

  it("checks each composite token's own input and output identities", () => {
    const outer = token({ id: "outer", allowedModels: "B" });
    const member = token({ id: "member", allowedModels: "C", modelMappingRules: [mapping("A", "C")] });
    expect(resolve([outer, member], channel(["C"])).effectiveModel).toBe("C");
    expect(resolve([{ ...outer, allowedModels: "C" }, member], channel(["C"]))).toMatchObject({
      modelConfig: null,
      reason: "model-not-allowed",
    });
    expect(
      resolve(
        [
          { ...outer, modelMappingRules: [] },
          { ...member, allowedModels: "B" },
        ],
        channel(["C"]),
        { requestedModel: "A" },
      ),
    ).toMatchObject({
      modelConfig: null,
      reason: "model-not-allowed",
    });
  });

  it("falls back from an outer target rejected by the member whitelist to its viable original", () => {
    const result = resolve(
      [token({ id: "outer" }), token({ id: "member", allowedModels: "B", modelMappingRules: [] })],
      channel(["A", "B"]),
    );
    expect(result).toMatchObject({ effectiveModel: "B", outcome: "fallback" });
    expect(result.modelConfig?.provider).toBe("B");
  });
});

describe("channel mapping fallback and non-recursive rule tables", () => {
  it.each(["deepseek-flash", "deepseek-v4.1-flash", "deepseek-ai/DeepSeek-V4.1-Flash"])(
    "keeps the original model and both aliases available when requesting %s",
    (requestedModel) => {
      const upstreamModel = "deepseek-ai/DeepSeek-V4.1-Flash";
      const config = { model: "DeepSeek Flash", provider: upstreamModel, supportedFormats: CHAT };
      const result = resolve(
        [token({ modelMappingRules: [], allowedModels: null })],
        channel([upstreamModel], {
          modelMapping: { "deepseek-flash": upstreamModel, "deepseek-v4.1-flash": upstreamModel },
        }),
        { requestedModel, modelCatalog: [config] },
      );
      expect(result.modelConfig).toBe(config);
      expect(result.effectiveModel).toBe(upstreamModel);
    },
  );

  it("tries channel mapping after an unavailable token target", () => {
    const result = resolve([token()], channel(["C"], { modelMapping: { B: "C" } }));
    expect(result).toMatchObject({ effectiveModel: "C", outcome: "fallback" });
    expect(result.steps[0]).toMatchObject({ inputModel: "B", fallback: true });
  });

  it("retains the original when the token target and channel target are unavailable", () => {
    expect(resolve([token()], channel(["B"], { modelMapping: { B: "missing" } }))).toMatchObject({
      effectiveModel: "B",
      outcome: "fallback",
    });
  });

  it("uses channel mappings for an unmapped token, but does not rewrite a selected token target", () => {
    expect(
      resolve([token({ modelMappingRules: [] })], channel(["C"], { modelMapping: { B: "C" } })).effectiveModel,
    ).toBe("C");
    expect(resolve([token()], channel(["A", "C"], { modelMapping: { A: "C", B: "C" } })).effectiveModel).toBe("A");
  });

  it("does not recursively apply B -> A -> C within one token table", () => {
    const tokens = [token({ modelMappingRules: [mapping("B", "A"), mapping("A", "C")] })];
    expect(resolve(tokens, channel(["A", "C"])).effectiveModel).toBe("A");
    expect(resolve(tokens, channel(["C"])).modelConfig).toBeNull();
    expect(resolve(tokens, channel(["B", "C"])).effectiveModel).toBe("B");
  });

  it("does not recursively apply B -> A -> C within a channel table", () => {
    const result = resolve([token({ modelMappingRules: [] })], channel(["C"], { modelMapping: { B: "A", A: "C" } }));
    expect(result.modelConfig).toBeNull();
  });

  it("keeps an unavailable exact winner from falling through to a less specific token rule", () => {
    const result = resolve(
      [token({ modelMappingRules: [mapping("*", "C"), mapping("B", "missing")] })],
      channel(["C"]),
    );
    expect(result.modelConfig).toBeNull();
    expect(result.steps[0].rule?.source).toBe("B");
  });
});

describe("composite token paths", () => {
  it("applies the outer scoped mapping then the member's own mapping once each", () => {
    const tokens = [
      token({ id: "outer", modelMappingRules: [mapping("B", "A", "mapping-first", ["pool"])] }),
      token({ id: "member", modelMappingRules: [mapping("A", "C")] }),
    ];
    const leaf = channel(["B", "C"]);
    const mapped = resolve(tokens, leaf, { channelPathIds: ["pool", "leaf"] });
    expect(mapped).toMatchObject({ effectiveModel: "C", outcome: "mapped" });
    expect(mapped.steps).toMatchObject([
      { tokenId: "outer", inputModel: "B", outputModel: "A", fallback: false },
      { tokenId: "member", inputModel: "A", outputModel: "C", fallback: false },
    ]);
    expect(resolve(tokens, leaf, { channelPathIds: ["other", "leaf"] }).effectiveModel).toBe("B");
  });

  it("decides outer original-first preference using the complete member route", () => {
    const tokens = [
      token({ id: "outer", modelMappingRules: [mapping("B", "A", "original-first")] }),
      token({ id: "member", modelMappingRules: [mapping("B", "C")] }),
    ];
    const result = resolve(tokens, channel(["A", "C"]));
    expect(result.effectiveModel).toBe("C");
    expect(result.steps).toMatchObject([
      { inputModel: "B", outputModel: "B" },
      { inputModel: "B", outputModel: "C" },
    ]);
  });

  it("does not mutate frozen inputs or retain policy across sibling paths and repeat calls", () => {
    const tokens = freezeDeep([
      token({
        id: "outer",
        modelMappingRules: [
          mapping("B", "A", "mapping-first", ["left"]),
          mapping("B", "C", "mapping-first", ["right"]),
        ],
      }),
      token({ id: "member", modelMappingRules: [] }),
    ]);
    const leaf = freezeDeep(channel(["A", "B", "C"]));
    const modelCatalog = freezeDeep(structuredClone(catalog));
    const leftPath = freezeDeep(["root", "left", "leaf"]);
    const rightPath = freezeDeep(["root", "right", "leaf"]);
    const before = JSON.stringify({ tokens, leaf, modelCatalog, leftPath, rightPath });
    expect(resolve(tokens, leaf, { modelCatalog, channelPathIds: leftPath }).effectiveModel).toBe("A");
    expect(resolve(tokens, leaf, { modelCatalog, channelPathIds: rightPath }).effectiveModel).toBe("C");
    expect(resolve(tokens, leaf, { modelCatalog, channelPathIds: leftPath }).effectiveModel).toBe("A");
    expect(JSON.stringify({ tokens, leaf, modelCatalog, leftPath, rightPath })).toBe(before);
  });
});

describe("request format transformations", () => {
  it("applies a token format transform before checking mapped target availability", () => {
    const result = resolve(
      [token({ requestFormatTransforms: [{ sourceFormat: CHAT, targetFormat: "anthropic" }] })],
      channel(["A"], { allowedFormats: "anthropic" }),
      { modelCatalog: [{ ...catalog[0], supportedFormats: "anthropic" }] },
    );
    expect(result).toMatchObject({ effectiveModel: "A", requestFormat: "anthropic", outcome: "mapped" });
    expect(result.steps[0]).toMatchObject({ sourceFormat: CHAT, targetFormat: "anthropic" });
  });

  it("chains outer and member format transformations along the same model path", () => {
    const result = resolve(
      [
        token({ id: "outer", requestFormatTransforms: [{ sourceFormat: CHAT, targetFormat: "anthropic" }] }),
        token({
          id: "member",
          modelMappingRules: [mapping("A", "C")],
          requestFormatTransforms: [{ sourceFormat: "anthropic", targetFormat: "openai-responses" }],
        }),
      ],
      channel(["C"], { allowedFormats: "openai-responses" }),
      { modelCatalog: [{ ...catalog[2], supportedFormats: "openai-responses" }] },
    );
    expect(result).toMatchObject({ effectiveModel: "C", requestFormat: "openai-responses" });
    expect(result.steps).toMatchObject([
      { inputModel: "B", outputModel: "A", sourceFormat: CHAT, targetFormat: "anthropic" },
      { inputModel: "A", outputModel: "C", sourceFormat: "anthropic", targetFormat: "openai-responses" },
    ]);
  });

  it("falls back on the transformed format when the target model lacks that format", () => {
    const result = resolve(
      [token({ requestFormatTransforms: [{ sourceFormat: CHAT, targetFormat: "anthropic" }] })],
      channel(["A", "B"], { allowedFormats: "anthropic" }),
      { modelCatalog: [catalog[0], { ...catalog[1], supportedFormats: "anthropic" }] },
    );
    expect(result).toMatchObject({ effectiveModel: "B", requestFormat: "anthropic", outcome: "fallback" });
  });

  it("rejects a channel that does not accept the final transformed format", () => {
    const result = resolve(
      [token({ requestFormatTransforms: [{ sourceFormat: CHAT, targetFormat: "anthropic" }] })],
      channel(["A", "B"]),
    );
    expect(result).toMatchObject({ modelConfig: null, outcome: "unavailable", reason: "format-unsupported" });
  });

  it("does not recursively transform a second rule in the same token", () => {
    const result = resolve(
      [
        token({
          requestFormatTransforms: [
            { sourceFormat: CHAT, targetFormat: "anthropic" },
            { sourceFormat: "anthropic", targetFormat: "openai-responses" },
          ],
        }),
      ],
      channel(["A"], { allowedFormats: "anthropic" }),
      { modelCatalog: [{ ...catalog[0], supportedFormats: "anthropic" }] },
    );
    expect(result.requestFormat).toBe("anthropic");
    expect(result.effectiveModel).toBe("A");
  });

  it.each([CHAT, "openai", "gemini"] as const)("preserves untransformed request format %s", (requestFormat) => {
    const result = resolve([token({ modelMappingRules: [] })], channel(["B"], { allowedFormats: "openai,gemini" }), {
      requestFormat: requestFormat as RelayRequestFormat,
      modelCatalog: [{ ...catalog[1], supportedFormats: "openai,gemini" }],
    });
    expect(result.requestFormat).toBe(requestFormat);
    expect(result.effectiveModel).toBe("B");
  });
});

describe("catalog display compatibility and discovery candidates", () => {
  it.each(["A", "Display A"])("accepts exact legacy target %s and resolves the provider ID", (target) => {
    const result = resolve(
      [token({ modelMappingRules: undefined, modelMapping: { B: target } })],
      channel(["Display A"]),
    );
    expect(result.effectiveModel).toBe("A");
    expect(result.modelConfig).toBe(catalog[0]);
  });

  it("retains a good alias from malformed legacy data and trims its target", () => {
    const legacy = { bad: 10, empty: " ", good: " A " };
    expect(
      resolve([token({ modelMappingRules: undefined, modelMapping: legacy })], channel(["A"]), {
        requestedModel: "good",
      }).effectiveModel,
    ).toBe("A");
  });

  it("does not treat an unmapped display label or a case-mismatched target as an identity", () => {
    expect(
      resolve([token({ modelMappingRules: [] })], channel(["Display A"]), { requestedModel: "Display A" }).modelConfig,
    ).toBeNull();
    expect(resolve([token({ modelMappingRules: [mapping("B", "display a")] })], channel(["A"])).modelConfig).toBeNull();
  });

  it("prefers an exact provider identity over a colliding catalog display label", () => {
    const modelCatalog = [{ model: "A", provider: "C", supportedFormats: CHAT }, ...catalog];
    expect(resolve([token()], channel(["A", "C"]), { modelCatalog }).effectiveModel).toBe("A");
  });

  it("enumerates finite seeds while keeping wildcard rules from inventing model names", () => {
    const result = relayModelRouteRequestCandidates(
      [
        token({
          allowedModels: "B,allowed-only,*",
          modelMappingRules: [mapping("alias", "A"), mapping("wild-*", "C")],
        }),
      ],
      [
        channel(["A"], { modelMapping: { "channel-alias": "A" } }),
        channel([], { id: "unrestricted", allowedModels: null }),
      ],
      [...catalog, { model: "Unconfigured", provider: "unconfigured", supportedFormats: CHAT }],
    );
    expect(result).toEqual(
      ["A", "B", "C", "alias", "allowed-only", "channel-alias"].sort((a, b) => a.localeCompare(b)),
    );
    expect(result).not.toContain("wild-*");
    expect(result).not.toContain("unconfigured");
    expect(result).not.toContain("Display A");
  });
});

describe("per-token channel multiplier ceiling", () => {
  it.each([
    [0.99, 1, true],
    [1, 1, true],
    [1.01, 1, false],
    ["1.00", "1", true],
    ["1.01", "1", false],
    [100, null, true],
    [100, undefined, true],
    [0, 0, true],
    [0.01, 0, false],
  ])("channel multiplier %s with ceiling %s is allowed=%s", (multiplier, maximum, allowed) => {
    const result = resolve(
      [token({ failoverConfig: { maxAcceptedChannelMultiplier: maximum } })],
      channel(["A"], { multiplier }),
    );
    if (allowed) expect(result.modelConfig?.provider).toBe("A");
    else expect(result).toMatchObject({ modelConfig: null, outcome: "unavailable", reason: "multiplier-exceeded" });
  });

  it.each([0, 1])("enforces the ceiling on composite token index %s", (restrictedIndex) => {
    const tokens = [token({ id: "outer" }), token({ id: "member", modelMappingRules: [] })];
    tokens[restrictedIndex].failoverConfig = { maxAcceptedChannelMultiplier: 1 };
    expect(resolve(tokens, channel(["A", "B"], { multiplier: 2 }))).toMatchObject({
      modelConfig: null,
      outcome: "unavailable",
      reason: "multiplier-exceeded",
    });
  });
});
