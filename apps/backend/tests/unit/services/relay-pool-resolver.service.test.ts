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
    allowedFormats: "all",
    allowedModels: null,
    routingConfig: { allowedModelsMode: "all" },
    poolMembers: [],
    ...overrides,
  }) as any;

const createResolver = (channels: any[]) => {
  const relayChannelRepository = {
    listActive: vi.fn().mockResolvedValue(channels),
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

    expect(resolvedLeaf.allowedFormats).toBe("openai");
    expect(resolvedLeaf.allowedModels).toBe(JSON.stringify(["gpt-4o"]));
    expect((resolvedLeaf.routingConfig as any).allowedModelsMode).toBe("manual");
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
});
