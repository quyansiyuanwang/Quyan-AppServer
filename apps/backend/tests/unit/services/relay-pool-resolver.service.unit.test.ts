import { describe, expect, it, vi } from "vitest";
import { RELAY_CHANNEL_STATUS } from "../../../src/constant/relay-channel";
import { RelayPoolResolverService } from "../../../src/services/relay/relay-pool-resolver.service";
import { BadRequestError } from "../../../src/util/errors";

const createChannel = (id: string, overrides: Record<string, unknown> = {}) =>
  ({
    id,
    name: id,
    status: RELAY_CHANNEL_STATUS.ENABLED,
    channelType: "standalone",
    allowedFormats: null,
    allowedModels: null,
    routingConfig: { allowedModelsMode: "all" },
    poolMembers: [],
    ...overrides,
  }) as any;

const createResolver = (channels: any[]) => {
  const relayChannelRepository = {
    listActive: vi.fn().mockResolvedValue(channels),
    listVisible: vi.fn().mockResolvedValue(channels),
  };
  const ResolverCtor = RelayPoolResolverService as unknown as new (...args: any[]) => RelayPoolResolverService;

  return { resolver: new ResolverCtor(relayChannelRepository), relayChannelRepository };
};

describe("RelayPoolResolverService", () => {
  it("recursively resolves enabled nested pools into standalone leaves", async () => {
    const leaf = createChannel("leaf");
    const innerPool = createChannel("inner", {
      channelType: "pooled",
      poolMembers: [{ memberChannelId: leaf.id, priority: 0, weight: 1, enabled: true }],
    });
    const outerPool = createChannel("outer", {
      channelType: "pooled",
      poolMembers: [{ memberChannelId: innerPool.id, priority: 0, weight: 1, enabled: true }],
    });
    const { resolver } = createResolver([outerPool, innerPool, leaf]);

    const leaves = await resolver.resolveActiveLeaves([outerPool]);

    expect(leaves.map((channel) => channel.id)).toEqual([leaf.id]);
  });

  it("preserves the configured root as the display channel for a pooled leaf", async () => {
    const leaf = createChannel("leaf");
    const pool = createChannel("pool", {
      channelType: "pooled",
      poolMembers: [{ memberChannelId: leaf.id, priority: 0, weight: 1, enabled: true }],
    });
    const { resolver } = createResolver([pool, leaf]);

    const candidates = await resolver.resolveActiveLeafCandidates([pool]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.resolvedChannel.id).toBe(leaf.id);
    expect(candidates[0]?.displayChannel.id).toBe(pool.id);
  });

  it("skips disabled edges and channels absent from the active graph", async () => {
    const activeLeaf = createChannel("active-leaf");
    const inactiveLeaf = createChannel("inactive-leaf", { status: RELAY_CHANNEL_STATUS.DISABLED });
    const pool = createChannel("pool", {
      channelType: "pooled",
      poolMembers: [
        { memberChannelId: "disabled-edge", priority: 0, weight: 1, enabled: false },
        { memberChannelId: inactiveLeaf.id, priority: 1, weight: 1, enabled: true },
        { memberChannelId: activeLeaf.id, priority: 2, weight: 1, enabled: true },
      ],
    });
    const { resolver } = createResolver([pool, activeLeaf]);

    const leaves = await resolver.resolveActiveLeaves([pool]);

    expect(leaves.map((channel) => channel.id)).toEqual([activeLeaf.id]);
  });

  it("resolves disabled channels only when explicitly using the visible graph", async () => {
    const disabledLeaf = createChannel("disabled-leaf", { status: RELAY_CHANNEL_STATUS.DISABLED });
    const { resolver, relayChannelRepository } = createResolver([]);
    relayChannelRepository.listVisible.mockResolvedValue([disabledLeaf]);
    const catalog = [{ model: "Disabled Model", provider: "disabled-model", supportedFormats: "openai" }];

    await expect(resolver.resolveEffectiveAllowedModels(disabledLeaf.id, catalog)).resolves.toEqual([]);
    await expect(
      resolver.resolveEffectiveAllowedModels(disabledLeaf.id, catalog, { includeDisabled: true }),
    ).resolves.toEqual(["Disabled Model"]);
    expect(relayChannelRepository.listActive).toHaveBeenCalledTimes(1);
    expect(relayChannelRepository.listVisible).toHaveBeenCalledTimes(1);
  });

  it("intersects ancestor formats and manual model restrictions on leaves", async () => {
    const leaf = createChannel("leaf", {
      allowedFormats: "openai,anthropic",
      allowedModels: JSON.stringify(["gpt-4o", "claude-3-5-sonnet"]),
      routingConfig: { allowedModelsMode: "manual" },
    });
    const pool = createChannel("pool", {
      channelType: "pooled",
      allowedFormats: "openai",
      allowedModels: JSON.stringify(["gpt-4o", "gemini-2.0-flash"]),
      routingConfig: { allowedModelsMode: "manual" },
      poolMembers: [{ memberChannelId: leaf.id, priority: 0, weight: 1, enabled: true }],
    });
    const { resolver } = createResolver([pool, leaf]);

    const [resolvedLeaf] = await resolver.resolveActiveLeaves([pool]);

    expect(resolvedLeaf.allowedFormats).toBe("openai-chat-completions");
    expect(resolvedLeaf.allowedModels).toBe(JSON.stringify(["gpt-4o"]));
    expect((resolvedLeaf.routingConfig as any).allowedModelsMode).toBe("manual");
  });

  it("infers automatic proxy pool models from enabled member constraints", async () => {
    const compatibleLeaf = createChannel("compatible", {
      allowedFormats: "openai,anthropic",
      allowedModels: JSON.stringify(["gpt-4o", "claude-3-5-sonnet"]),
      routingConfig: { allowedModelsMode: "manual" },
    });
    const disabledLeaf = createChannel("disabled", { status: RELAY_CHANNEL_STATUS.DISABLED });
    const automaticPool = createChannel("automatic-pool", {
      channelType: "automatic-proxy-pool",
      allowedFormats: "openai",
      allowedModels: JSON.stringify(["gpt-4o"]),
      routingConfig: { allowedModelsMode: "manual" },
      poolMembers: [
        { memberChannelId: compatibleLeaf.id, priority: 0, weight: 1, enabled: true },
        { memberChannelId: disabledLeaf.id, priority: 1, weight: 1, enabled: true },
      ],
    });
    const { resolver } = createResolver([automaticPool, compatibleLeaf]);
    const catalog = [
      { model: "gpt-4o", provider: "gpt-4o", supportedFormats: "openai" },
      { model: "claude-3-5-sonnet", provider: "claude", supportedFormats: "anthropic" },
    ];

    await expect(resolver.resolveEffectiveAllowedModels(automaticPool.id, catalog)).resolves.toEqual(["gpt-4o"]);
  });

  it("does not treat all and auto modes as manual restrictions", async () => {
    const leaf = createChannel("leaf", {
      allowedModels: JSON.stringify(["gpt-4o"]),
      routingConfig: { allowedModelsMode: "manual" },
    });
    const pool = createChannel("pool", {
      channelType: "pooled",
      allowedModels: JSON.stringify(["should-not-restrict"]),
      routingConfig: { allowedModelsMode: "auto" },
      poolMembers: [{ memberChannelId: leaf.id, priority: 0, weight: 1, enabled: true }],
    });
    const { resolver } = createResolver([pool, leaf]);

    const [resolvedLeaf] = await resolver.resolveActiveLeaves([pool]);

    expect(resolvedLeaf.allowedModels).toBe(JSON.stringify(["gpt-4o"]));
  });

  it("passes every nested pool through the orderer and honors its local selection", async () => {
    const selectedLeaf = createChannel("selected-leaf");
    const skippedLeaf = createChannel("skipped-leaf");
    const innerPool = createChannel("inner", {
      channelType: "pooled",
      poolMembers: [
        { memberChannelId: selectedLeaf.id, priority: 0, weight: 1, enabled: true },
        { memberChannelId: skippedLeaf.id, priority: 1, weight: 1, enabled: true },
      ],
    });
    const outerPool = createChannel("outer", {
      channelType: "pooled",
      poolMembers: [{ memberChannelId: innerPool.id, priority: 0, weight: 1, enabled: true }],
    });
    const { resolver } = createResolver([outerPool, innerPool, selectedLeaf, skippedLeaf]);
    const orderedPoolIds: string[] = [];

    const leaves = await resolver.resolveActiveLeaves([outerPool], async (pool, members) => {
      orderedPoolIds.push(pool.id);
      return members.slice(0, 1);
    });

    expect(orderedPoolIds).toEqual([outerPool.id, innerPool.id]);
    expect(leaves.map((channel) => channel.id)).toEqual([selectedLeaf.id]);
  });

  it("marks nested pooled members for full traversal beneath an automatic pool", async () => {
    const firstLeaf = createChannel("first-leaf");
    const secondLeaf = createChannel("second-leaf");
    const nestedPool = createChannel("nested-pool", {
      channelType: "pooled",
      poolMembers: [
        { memberChannelId: firstLeaf.id, priority: 0, weight: 1, enabled: true },
        { memberChannelId: secondLeaf.id, priority: 1, weight: 1, enabled: true },
      ],
    });
    const automaticPool = createChannel("automatic-pool", {
      channelType: "automatic-proxy-pool",
      poolMembers: [{ memberChannelId: nestedPool.id, priority: 0, weight: 1, enabled: true }],
    });
    const { resolver } = createResolver([automaticPool, nestedPool, firstLeaf, secondLeaf]);
    const contexts: Record<string, boolean> = {};

    const leaves = await resolver.resolveActiveLeaves([automaticPool], async (pool, members, context) => {
      contexts[pool.id] = context.expandAllEligibleMembers;
      return members;
    });

    expect(leaves.map((channel) => channel.id)).toEqual([firstLeaf.id, secondLeaf.id]);
    expect(contexts).toEqual({ [automaticPool.id]: true, [nestedPool.id]: true });
  });

  it("preserves distinct constraints for duplicate leaf paths", async () => {
    const leaf = createChannel("leaf");
    const openaiPool = createChannel("openai-pool", {
      channelType: "pooled",
      allowedFormats: "openai",
      allowedModels: JSON.stringify(["model-a"]),
      routingConfig: { allowedModelsMode: "manual" },
      modelMapping: { "request-a": "upstream-a" },
      poolMembers: [{ memberChannelId: leaf.id, priority: 0, weight: 1, enabled: true }],
    });
    const anthropicPool = createChannel("anthropic-pool", {
      channelType: "pooled",
      allowedFormats: "anthropic",
      allowedModels: JSON.stringify(["model-b"]),
      routingConfig: { allowedModelsMode: "manual" },
      modelMapping: { "request-b": "upstream-b" },
      poolMembers: [{ memberChannelId: leaf.id, priority: 0, weight: 1, enabled: true }],
    });
    const root = createChannel("root", {
      channelType: "pooled",
      poolMembers: [
        { memberChannelId: openaiPool.id, priority: 0, weight: 1, enabled: true },
        { memberChannelId: anthropicPool.id, priority: 1, weight: 1, enabled: true },
      ],
    });
    const { resolver } = createResolver([root, openaiPool, anthropicPool, leaf]);

    const leaves = await resolver.resolveActiveLeaves([root]);

    expect(leaves).toHaveLength(2);
    expect(
      leaves.map((channel) => ({
        formats: channel.allowedFormats,
        models: JSON.parse(channel.allowedModels as string),
        mapping: channel.modelMapping,
      })),
    ).toEqual([
      { formats: "openai-chat-completions", models: ["model-a"], mapping: { "request-a": "upstream-a" } },
      { formats: "anthropic", models: ["model-b"], mapping: { "request-b": "upstream-b" } },
    ]);
  });

  it("rejects direct and indirect pool cycles at runtime", async () => {
    const poolA = createChannel("pool-a", {
      channelType: "pooled",
      poolMembers: [{ memberChannelId: "pool-b", priority: 0, weight: 1, enabled: true }],
    });
    const poolB = createChannel("pool-b", {
      channelType: "pooled",
      poolMembers: [{ memberChannelId: poolA.id, priority: 0, weight: 1, enabled: true }],
    });
    const { resolver } = createResolver([poolA, poolB]);

    await expect(resolver.resolveActiveLeaves([poolA])).rejects.toThrow(BadRequestError);
  });

  it("infers only catalog models that are compatible with effective leaf constraints", async () => {
    const leaf = createChannel("leaf", {
      allowedFormats: "openai",
      allowedModels: JSON.stringify(["gpt-4o"]),
      routingConfig: { allowedModelsMode: "manual" },
    });
    const pool = createChannel("pool", {
      channelType: "pooled",
      poolMembers: [{ memberChannelId: leaf.id, priority: 0, weight: 1, enabled: true }],
    });
    const { resolver } = createResolver([pool, leaf]);

    const models = await resolver.inferAllowedModels(pool.id, [
      { model: "gpt-4o", supportedFormats: "openai" },
      { model: "claude-3-5-sonnet", supportedFormats: "anthropic" },
      { model: "gpt-4o-mini", supportedFormats: "openai" },
    ]);

    expect(models).toEqual(["gpt-4o"]);
  });

  it("keeps request IDs separate from catalog names and inherits model mappings", async () => {
    const leaf = createChannel("leaf", {
      allowedFormats: "openai",
      allowedModels: JSON.stringify(["GPT 4o"]),
      routingConfig: { allowedModelsMode: "manual" },
      modelMapping: { "gpt-4o": "upstream-gpt-4o" },
    });
    const pool = createChannel("pool", {
      channelType: "pooled",
      modelMapping: { "gpt-4o": "pool-gpt-4o" },
      poolMembers: [{ memberChannelId: leaf.id, priority: 0, weight: 1, enabled: true }],
    });
    const { resolver } = createResolver([pool, leaf]);
    const context = await resolver.preloadContext([
      { model: "GPT 4o", provider: "gpt-4o", supportedFormats: "openai,anthropic" },
    ]);

    const capabilities = await resolver.resolveChannelCapabilities(pool.id, context);

    expect(capabilities).toEqual([
      {
        leafChannelId: leaf.id,
        catalogModelName: "GPT 4o",
        requestModelId: "gpt-4o",
        supportedRequestFormats: ["openai-chat-completions"],
        modelMapping: { "gpt-4o": "upstream-gpt-4o" },
      },
    ]);
  });

  it("does not mix formats from a path that denies the model", async () => {
    const leaf = createChannel("leaf");
    const openaiPath = createChannel("openai-path", {
      channelType: "pooled",
      allowedFormats: "openai",
      allowedModels: JSON.stringify([]),
      routingConfig: { allowedModelsMode: "manual" },
      poolMembers: [{ memberChannelId: leaf.id, priority: 0, weight: 1, enabled: true }],
    });
    const anthropicPath = createChannel("anthropic-path", {
      channelType: "pooled",
      allowedFormats: "anthropic",
      allowedModels: JSON.stringify(["Claude"]),
      routingConfig: { allowedModelsMode: "manual" },
      poolMembers: [{ memberChannelId: leaf.id, priority: 0, weight: 1, enabled: true }],
    });
    const root = createChannel("root", {
      channelType: "pooled",
      poolMembers: [
        { memberChannelId: openaiPath.id, priority: 0, weight: 1, enabled: true },
        { memberChannelId: anthropicPath.id, priority: 1, weight: 1, enabled: true },
      ],
    });
    const { resolver } = createResolver([root, openaiPath, anthropicPath, leaf]);
    const context = await resolver.preloadContext([
      { model: "Claude", provider: "claude-3-5-sonnet", supportedFormats: "openai,anthropic" },
    ]);

    const capabilities = await resolver.resolveChannelCapabilities(root.id, context);

    expect(capabilities).toHaveLength(1);
    expect(capabilities[0]?.supportedRequestFormats).toEqual(["anthropic"]);
  });

  it("preserves an empty format intersection as deny-all in compatibility leaves", async () => {
    const leaf = createChannel("leaf", { allowedFormats: "anthropic" });
    const pool = createChannel("pool", {
      channelType: "pooled",
      allowedFormats: "openai",
      poolMembers: [{ memberChannelId: leaf.id, priority: 0, weight: 1, enabled: true }],
    });
    const { resolver } = createResolver([pool, leaf]);

    const [resolvedLeaf] = await resolver.resolveActiveLeaves([pool]);

    expect(resolvedLeaf.allowedFormats).toBe("none");
  });

  it("reuses a preloaded graph when resolving multiple channels", async () => {
    const first = createChannel("first");
    const second = createChannel("second");
    const { resolver, relayChannelRepository } = createResolver([first, second]);
    const context = await resolver.preloadContext([{ model: "GPT", provider: "gpt", supportedFormats: "openai" }]);

    await resolver.resolveChannelCapabilities(first.id, context);
    await resolver.resolveChannelCapabilities(second.id, context);

    expect(relayChannelRepository.listActive).toHaveBeenCalledTimes(1);
  });
});
