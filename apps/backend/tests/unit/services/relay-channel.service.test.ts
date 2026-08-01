import { beforeEach, describe, expect, it, vi } from "vitest";
import { RelayChannelService } from "../../../src/services/relay/relay-channel.service";
import { RelayTokenRepository } from "../../../src/store/relay/relay-token.repository";
import { RELAY_CHANNEL_STATUS } from "../../../src/constant/relay-channel";
import { OperationType } from "../../../src/constant/operation-type";
import { Permission } from "../../../src/constant/permission";
import { NotFoundError } from "../../../src/util/errors";

describe("RelayChannelService", () => {
  const transactionClient = {} as any;
  const relayChannelRepository = {
    listActive: vi.fn(),
    listVisible: vi.fn(),
    listVisibleByIds: vi.fn(),
    listActiveDirectPooledParentsByMemberChannelId: vi.fn(),
    findVisibleByName: vi.fn(),
    findActiveById: vi.fn(),
    findVisibleById: vi.fn(),
    withTransaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(transactionClient)),
    create: vi.fn(),
    updateById: vi.fn(),
    countDirectBusinessReferences: vi.fn(),
    replaceMembersByChannelId: vi.fn(),
    deleteMembersByChannelId: vi.fn(),
    softDeleteAndUnassignTokens: vi.fn(),
    softDeleteAndUnassignTokensByIds: vi.fn(),
    updateStatusByIds: vi.fn(),
  };
  const businessLogService = {
    logOperation: vi.fn(),
  };
  const userRepository = {
    findByIdWithGroup: vi.fn(),
  };
  const ramRoleRepository = {
    listRoleBindingsForUser: vi.fn(),
  };
  const permissionService = {
    hasAnyPermission: vi.fn(),
    hasPermission: vi.fn(),
  };
  const modelPricingService = {
    getModelPricing: vi.fn(),
  };
  const relayPoolResolver = {
    resolveEffectiveAllowedModels: vi.fn(),
    preloadContext: vi.fn(),
    resolveChannelCapabilities: vi.fn(),
  };
  const relayChannelHealthService = {};
  const relayConfigService = {
    getRelayConfig: vi.fn(),
  };
  const relayTokenRepository = {
    findManagedPoolsByOwnerUserId: vi.fn(),
    findManagedPoolByRelayChannelId: vi.fn(),
  };

  const RelayChannelServiceCtor = RelayChannelService as unknown as new (...args: any[]) => RelayChannelService;

  const service = new RelayChannelServiceCtor(
    relayChannelRepository,
    businessLogService,
    userRepository,
    ramRoleRepository,
    permissionService,
    modelPricingService,
    relayPoolResolver,
    relayChannelHealthService,
    relayConfigService,
  );

  const now = new Date("2026-01-01T00:00:00.000Z");
  const sampleChannel = {
    id: "channel-1",
    status: RELAY_CHANNEL_STATUS.ENABLED,
    name: "Main",
    openaiUpstreamUrl: "https://upstream.example.com",
    openaiUpstreamApiKey: "openai-key",
    anthropicUpstreamUrl: null,
    anthropicUpstreamApiKey: null,
    geminiUpstreamUrl: null,
    geminiUpstreamApiKey: null,
    multiplier: 1,
    allowedFormats: "openai",
    allowedModels: null,
    addUserIdentifier: true,
    inputTokensIncludeCacheRead: false,
    createTime: now,
    updateTime: now,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    relayChannelRepository.listVisible.mockResolvedValue([sampleChannel]);
    relayChannelRepository.listVisibleByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ ...sampleChannel, id })),
    );
    relayChannelRepository.listActiveDirectPooledParentsByMemberChannelId.mockResolvedValue([]);
    relayChannelRepository.findVisibleByName.mockResolvedValue(null);
    permissionService.hasAnyPermission.mockResolvedValue(false);
    permissionService.hasPermission.mockImplementation(
      async (_userId: string, permission: Permission) => permission === Permission.RELAY_CHANNEL_POOL_METADATA_READ,
    );
    userRepository.findByIdWithGroup.mockResolvedValue({ id: "actor-user", groupId: "group-1" });
    ramRoleRepository.listRoleBindingsForUser.mockResolvedValue([]);
    modelPricingService.getModelPricing.mockResolvedValue([]);
    relayPoolResolver.resolveEffectiveAllowedModels.mockResolvedValue([]);
    relayPoolResolver.preloadContext.mockResolvedValue({ graph: new Map(), modelCatalog: [] });
    relayPoolResolver.resolveChannelCapabilities.mockResolvedValue([]);
    relayConfigService.getRelayConfig.mockResolvedValue({ apiCatalogPoolVisibility: "anonymous-range" });
    relayTokenRepository.findManagedPoolsByOwnerUserId.mockResolvedValue([]);
    relayTokenRepository.findManagedPoolByRelayChannelId.mockResolvedValue(null);
    vi.spyOn(RelayTokenRepository, "getInstance").mockReturnValue(relayTokenRepository as any);
  });

  it("lists active channels", async () => {
    relayChannelRepository.listActive.mockResolvedValue([sampleChannel]);

    const result = await service.listChannels("actor-user");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("channel-1");
    expect(result[0].enabled).toBe(true);
  });

  it("publishes pooled channels as logical price ranges without topology", async () => {
    relayChannelRepository.listActive.mockResolvedValue([
      { ...sampleChannel, id: "standalone-channel", channelType: "standalone", visibilityMode: "public" },
      { ...sampleChannel, id: "pool-member-a", name: "Member A", multiplier: 1.2, channelType: "standalone" },
      { ...sampleChannel, id: "pool-member-b", name: "Member B", multiplier: 1.8, channelType: "standalone" },
      {
        ...sampleChannel,
        id: "pooled-channel",
        name: "GPT Route",
        channelType: "pooled",
        visibilityMode: "public",
        poolMembers: [
          { memberChannelId: "pool-member-a", enabled: true },
          { memberChannelId: "pool-member-b", enabled: true },
        ],
      },
      {
        ...sampleChannel,
        id: "automatic-pool-channel",
        channelType: "automatic-proxy-pool",
        visibilityMode: "public",
      },
    ]);
    relayPoolResolver.resolveChannelCapabilities.mockResolvedValue([
      {
        catalogModelName: "gpt-4o-mini",
        requestModelId: "gpt-4o-mini",
        supportedRequestFormats: ["openai"],
        leafChannelId: "pool-member-a",
      },
      {
        catalogModelName: "gpt-4o-mini",
        requestModelId: "gpt-4o-mini",
        supportedRequestFormats: ["openai"],
        leafChannelId: "pool-member-b",
      },
    ]);

    const result = await service.listCatalogOptions("actor-user");

    expect(result.map((channel) => channel.id)).toEqual(
      expect.arrayContaining(["automatic-pool-channel", "pooled-channel", "standalone-channel"]),
    );
    expect(result).toHaveLength(3);
    expect(result.find((channel) => channel.id === "pooled-channel")).toMatchObject({
      id: "pooled-channel",
      name: "GPT Route",
      pricingMode: "range",
      modelPriceRanges: [
        {
          catalogModelName: "gpt-4o-mini",
          requestModelId: "gpt-4o-mini",
          minMultiplier: 1.2,
          maxMultiplier: 1.8,
        },
      ],
      priceMayVary: true,
    });
    expect(result.find((channel) => channel.id === "pooled-channel")).not.toHaveProperty("channelType");
    expect(result.find((channel) => channel.id === "pooled-channel")).not.toHaveProperty("poolPricing");
    expect(result.find((channel) => channel.id === "pooled-channel")).not.toHaveProperty("automaticProxyPool");
  });

  it("hides pooled channels from the catalog when pool publication is disabled", async () => {
    relayChannelRepository.listActive.mockResolvedValue([
      { ...sampleChannel, id: "standalone-channel", channelType: "standalone", visibilityMode: "public" },
      { ...sampleChannel, id: "pooled-channel", channelType: "pooled", visibilityMode: "public" },
    ]);
    relayConfigService.getRelayConfig.mockResolvedValue({ apiCatalogPoolVisibility: "hidden" });

    const result = await service.listCatalogOptions("actor-user");

    expect(result.map((channel) => channel.id)).toEqual(["standalone-channel"]);
  });

  it("resolves a unique accessible direct pooled parent for balance display", async () => {
    const parentPool = {
      ...sampleChannel,
      id: "claude-gwl",
      name: "Claude-GWL",
      channelType: "pooled",
      visibilityMode: "public",
    };
    relayChannelRepository.listActiveDirectPooledParentsByMemberChannelId.mockResolvedValue([parentPool]);

    await expect(service.resolveUniqueAccessibleDirectPooledParent("claude-gwl-1", "token-owner")).resolves.toEqual(
      parentPool,
    );
    expect(relayChannelRepository.listActiveDirectPooledParentsByMemberChannelId).toHaveBeenCalledWith("claude-gwl-1");
  });

  it("resolves a whitelisted direct pooled parent only for an allowed user", async () => {
    const parentPool = {
      ...sampleChannel,
      id: "claude-gwl",
      channelType: "pooled",
      visibilityMode: "whitelist",
      visibilityConfig: { userIds: ["token-owner"] },
    };
    relayChannelRepository.listActiveDirectPooledParentsByMemberChannelId.mockResolvedValue([parentPool]);

    await expect(service.resolveUniqueAccessibleDirectPooledParent("claude-gwl-1", "token-owner")).resolves.toEqual(
      parentPool,
    );
    await expect(service.resolveUniqueAccessibleDirectPooledParent("claude-gwl-1", "other-user")).resolves.toBeNull();

    permissionService.hasAnyPermission.mockResolvedValue(true);
    await expect(service.resolveUniqueAccessibleDirectPooledParent("claude-gwl-1", "other-user")).resolves.toBeNull();
  });

  it("does not infer a balance display parent when the candidate is ambiguous or not user-visible", async () => {
    const publicParent = {
      ...sampleChannel,
      id: "claude-gwl",
      channelType: "pooled",
      visibilityMode: "public",
    };
    relayChannelRepository.listActiveDirectPooledParentsByMemberChannelId.mockResolvedValue([
      publicParent,
      { ...publicParent, id: "claude-backup" },
    ]);
    await expect(service.resolveUniqueAccessibleDirectPooledParent("claude-gwl-1", "token-owner")).resolves.toBeNull();

    relayChannelRepository.listActiveDirectPooledParentsByMemberChannelId.mockResolvedValue([
      { ...publicParent, visibilityMode: "private" },
    ]);
    await expect(service.resolveUniqueAccessibleDirectPooledParent("claude-gwl-1", "token-owner")).resolves.toBeNull();

    relayChannelRepository.listActiveDirectPooledParentsByMemberChannelId.mockResolvedValue([
      { ...publicParent, visibilityMode: "hidden" },
    ]);
    await expect(service.resolveUniqueAccessibleDirectPooledParent("claude-gwl-1", "token-owner")).resolves.toBeNull();
  });

  it.skip("legacy token-managed pools were removed", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(sampleChannel);
    relayTokenRepository.findManagedPoolByRelayChannelId.mockResolvedValue({ relayChannelId: "channel-1" });

    await expect(service.updateChannel("channel-1", { name: "renamed" }, "actor-user")).rejects.toThrow(
      "Managed relay pools",
    );
    expect(relayChannelRepository.updateById).not.toHaveBeenCalled();
  });

  it("redacts upstream API keys from ordinary channel responses", async () => {
    relayChannelRepository.listActive.mockResolvedValue([
      {
        ...sampleChannel,
        anthropicUpstreamApiKey: "anthropic-key",
        geminiUpstreamApiKey: "",
      },
    ]);

    const [result] = await service.listChannels("actor-user");

    expect(result).not.toHaveProperty("openaiUpstreamApiKey");
    expect(result).not.toHaveProperty("anthropicUpstreamApiKey");
    expect(result).not.toHaveProperty("geminiUpstreamApiKey");
    expect(result.hasOpenaiUpstreamApiKey).toBe(true);
    expect(result.hasAnthropicUpstreamApiKey).toBe(true);
    expect(result.hasGeminiUpstreamApiKey).toBe(false);
  });

  it("includes upstream API keys only in channel exports", async () => {
    relayChannelRepository.listVisibleByIds.mockResolvedValue([sampleChannel]);

    const result = await service.exportChannels({ ids: ["channel-1"], includeDisabled: true }, "actor-user");

    expect(result.channels[0].openaiUpstreamApiKey).toBe("openai-key");
    expect(result.channels[0].anthropicUpstreamApiKey).toBeUndefined();
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: OperationType.RELAY_CHANNEL_EXPORT,
        actorUserId: "actor-user",
      }),
    );
  });

  it("expands selected pooled channel exports with their member dependencies", async () => {
    const member = { ...sampleChannel, id: "member-channel", name: "Member" };
    const pool = {
      ...sampleChannel,
      id: "pool-channel",
      name: "Pool",
      channelType: "pooled",
      poolMembers: [
        {
          id: "pool-member-1",
          memberChannelId: member.id,
          priority: 0,
          weight: 1,
          enabled: true,
          memberChannel: member,
        },
      ],
    };
    relayChannelRepository.listVisibleByIds.mockResolvedValueOnce([pool]).mockResolvedValueOnce([member]);

    const result = await service.exportChannels({ ids: [pool.id], includeDisabled: true }, "actor-user");

    expect(result.channels.map((channel) => channel.id)).toEqual([pool.id, member.id]);
    expect(result.channels[0]?.poolMembers).toEqual(
      expect.arrayContaining([expect.objectContaining({ memberChannelId: member.id })]),
    );
  });

  it("expands pooled dependencies when exporting all active channels", async () => {
    const member = { ...sampleChannel, id: "member-channel", name: "Member" };
    const pool = {
      ...sampleChannel,
      id: "pool-channel",
      name: "Pool",
      channelType: "pooled",
      poolMembers: [
        {
          id: "pool-member-1",
          memberChannelId: member.id,
          priority: 0,
          weight: 1,
          enabled: true,
          memberChannel: member,
        },
      ],
    };
    relayChannelRepository.listActive.mockResolvedValue([pool]);
    relayChannelRepository.listVisibleByIds.mockResolvedValue([member]);

    const result = await service.exportChannels({ includeDisabled: false }, "actor-user");

    expect(result.channels.map((channel) => channel.id)).toEqual([pool.id, member.id]);
  });

  it("rejects explicit export of an inaccessible channel", async () => {
    relayChannelRepository.listVisibleByIds.mockResolvedValue([
      { ...sampleChannel, id: "private-channel", visibilityMode: "private" },
    ]);

    await expect(
      service.exportChannels({ ids: ["private-channel"], includeDisabled: true }, "actor-user"),
    ).rejects.toThrow(NotFoundError);
    expect(businessLogService.logOperation).not.toHaveBeenCalled();
  });

  it("separates configured models from resolved capabilities", async () => {
    relayChannelRepository.listActive.mockResolvedValue([
      { ...sampleChannel, allowedModels: JSON.stringify(["configured-model"]) },
    ]);
    modelPricingService.getModelPricing.mockResolvedValue([{ model: "catalog-model" }]);
    relayPoolResolver.resolveEffectiveAllowedModels.mockResolvedValue(["catalog-model"]);

    const [result] = await service.listChannels("actor-user");

    expect(result.allowedModels).toEqual(["catalog-model"]);
    expect(result.configuredAllowedModels).toBe(JSON.stringify(["configured-model"]));
    expect(relayPoolResolver.resolveEffectiveAllowedModels).toHaveBeenCalledWith("channel-1", [
      { model: "catalog-model" },
    ]);
  });

  it("projects business channel options without management configuration", async () => {
    relayChannelRepository.listActive.mockResolvedValue([
      { ...sampleChannel, allowedModels: JSON.stringify(["configured-model"]) },
    ]);
    const modelCatalog = [{ model: "Catalog Model", provider: "request-model", supportedFormats: "openai" }];
    modelPricingService.getModelPricing.mockResolvedValue(modelCatalog);
    const resolverContext = { graph: new Map(), modelCatalog };
    relayPoolResolver.preloadContext.mockResolvedValue(resolverContext);
    relayPoolResolver.resolveChannelCapabilities.mockResolvedValue([
      {
        leafChannelId: "leaf-channel",
        catalogModelName: "Catalog Model",
        requestModelId: "request-model",
        supportedRequestFormats: ["openai"],
        modelMapping: { "request-model": "upstream-model" },
      },
      {
        leafChannelId: "second-leaf",
        catalogModelName: "Catalog Model",
        requestModelId: "request-model",
        supportedRequestFormats: ["anthropic"],
        modelMapping: {},
      },
    ]);

    const result = await service.listChannelOptions("actor-user");

    expect(result).toEqual([
      {
        id: "channel-1",
        name: "Main",
        enabled: true,
        multiplier: 1,
        allowedFormats: "openai",
        channelType: "standalone",
        modelCapabilities: [
          {
            catalogModelName: "Catalog Model",
            requestModelId: "request-model",
            supportedRequestFormats: ["openai", "anthropic"],
          },
        ],
      },
    ]);
    expect(relayPoolResolver.preloadContext).toHaveBeenCalledWith(modelCatalog);
    expect(relayPoolResolver.resolveChannelCapabilities).toHaveBeenCalledWith("channel-1", resolverContext);
    expect(result[0]).not.toHaveProperty("configuredAllowedModels");
    expect(result[0]).not.toHaveProperty("openaiUpstreamUrl");
    expect(result[0]).not.toHaveProperty("leafChannelId");
    expect(result[0].modelCapabilities[0]).not.toHaveProperty("modelMapping");
  });

  it("projects automatic pool options with formats inferred from member capabilities", async () => {
    relayChannelRepository.listActive.mockResolvedValue([
      { ...sampleChannel, id: "automatic-pool", channelType: "automatic-proxy-pool", allowedFormats: "all" },
    ]);
    relayPoolResolver.resolveChannelCapabilities.mockResolvedValue([
      {
        leafChannelId: "leaf-openai",
        catalogModelName: "OpenAI Model",
        requestModelId: "openai-model",
        supportedRequestFormats: ["openai"],
        modelMapping: {},
      },
      {
        leafChannelId: "leaf-anthropic",
        catalogModelName: "Anthropic Model",
        requestModelId: "anthropic-model",
        supportedRequestFormats: ["anthropic"],
        modelMapping: {},
      },
    ]);

    await expect(service.listChannelOptions("actor-user")).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "automatic-pool", allowedFormats: "openai,anthropic" })]),
    );
  });

  it("redacts pool topology from callers without pool metadata permission", async () => {
    permissionService.hasPermission.mockResolvedValue(false);
    relayChannelRepository.listActive.mockResolvedValue([
      { ...sampleChannel, id: "pooled-channel", channelType: "pooled" },
      { ...sampleChannel, id: "automatic-pool", channelType: "automatic-proxy-pool" },
    ]);

    const result = await service.listChannelOptions("actor-user");

    expect(result).toHaveLength(2);
    for (const option of result) {
      expect(option).not.toHaveProperty("channelType");
      expect(option).not.toHaveProperty("poolPricing");
      expect(option).not.toHaveProperty("automaticProxyPool");
    }
  });

  it("filters pooled channels before returning business options", async () => {
    relayChannelRepository.listActive.mockResolvedValue([
      { ...sampleChannel, id: "standalone-channel", channelType: "standalone" },
      { ...sampleChannel, id: "pooled-channel", channelType: "pooled" },
      { ...sampleChannel, id: "automatic-pool", channelType: "automatic-proxy-pool" },
    ]);

    const result = await service.listChannelOptions("actor-user", undefined, { excludePooled: true });

    expect(result.map((option) => option.id).sort()).toEqual(["automatic-pool", "standalone-channel"]);
  });

  it("projects pooled channel prices from final leaf members instead of its legacy multiplier", async () => {
    const pool = {
      ...sampleChannel,
      id: "pooled-channel",
      name: "Pooled Channel",
      channelType: "pooled",
      multiplier: 99,
    };
    const firstLeaf = {
      ...sampleChannel,
      id: "first-leaf",
      name: "First Leaf",
      multiplier: 1.25,
      timePeriodMultipliers: [],
    };
    const secondLeaf = {
      ...sampleChannel,
      id: "second-leaf",
      name: "Second Leaf",
      multiplier: 2,
      timePeriodMultipliers: [],
    };
    relayChannelRepository.listActive.mockResolvedValue([pool, firstLeaf, secondLeaf]);
    relayPoolResolver.resolveChannelCapabilities.mockImplementation(async (channelId: string) =>
      channelId === pool.id
        ? [
            {
              leafChannelId: firstLeaf.id,
              catalogModelName: "Catalog Model",
              requestModelId: "request-model",
              supportedRequestFormats: ["openai"],
              modelMapping: {},
            },
            {
              leafChannelId: secondLeaf.id,
              catalogModelName: "Catalog Model",
              requestModelId: "request-model",
              supportedRequestFormats: ["openai"],
              modelMapping: {},
            },
          ]
        : [],
    );

    const result = await service.listChannelOptions("actor-user");
    const option = result.find((item) => item.id === pool.id);

    expect(option?.poolPricing).toEqual({
      members: [
        expect.objectContaining({
          id: firstLeaf.id,
          name: firstLeaf.name,
          multiplier: 1.25,
          timePeriodMultiplier: 1,
          effectiveMultiplier: 1.25,
        }),
        expect.objectContaining({
          id: secondLeaf.id,
          name: secondLeaf.name,
          multiplier: 2,
          timePeriodMultiplier: 1,
          effectiveMultiplier: 2,
        }),
      ],
    });
    expect(option?.poolPricing?.members.map((member) => member.effectiveMultiplier)).not.toContain(99);
  });

  it("projects only safe automatic pool member details and current eligibility", async () => {
    relayChannelRepository.listActive.mockResolvedValue([
      {
        ...sampleChannel,
        id: "automatic-pool",
        name: "Automatic Pool",
        channelType: "automatic-proxy-pool",
        routingStrategy: "weighted-random",
        routingConfig: { maxRetries: 2, stickyByModel: true, allowedModelsMode: "auto" },
        poolMembers: [
          {
            memberChannelId: "active-member",
            priority: 10,
            weight: 3,
            enabled: true,
            memberChannel: {
              ...sampleChannel,
              id: "active-member",
              name: "Active Member",
              multiplier: 1.5,
              timePeriodMultipliers: [],
            },
          },
          {
            memberChannelId: "disabled-member",
            priority: 20,
            weight: 1,
            enabled: false,
            memberChannel: {
              ...sampleChannel,
              id: "disabled-member",
              name: "Disabled Member",
              multiplier: 2,
              timePeriodMultipliers: [],
            },
          },
        ],
      },
    ]);
    relayPoolResolver.resolveChannelCapabilities.mockResolvedValue([
      {
        leafChannelId: "active-member",
        catalogModelName: "Catalog Model",
        requestModelId: "request-model",
        supportedRequestFormats: ["openai"],
        modelMapping: { "request-model": "sensitive-upstream-model" },
      },
      {
        leafChannelId: "disabled-member",
        catalogModelName: "Catalog Model",
        requestModelId: "request-model",
        supportedRequestFormats: ["openai"],
        modelMapping: {},
      },
    ]);

    const [result] = await service.listChannelOptions("actor-user");
    const pool = result.automaticProxyPool;

    expect(pool).toEqual({
      routingStrategy: "weighted-random",
      routingConfig: { maxRetries: 2, stickyByModel: true },
      members: [
        expect.objectContaining({
          id: "active-member",
          name: "Active Member",
          enabled: true,
          priority: 10,
          weight: 3,
          multiplier: 1.5,
          timePeriodMultiplier: 1,
          effectiveMultiplier: 1.5,
          modelCapabilities: [
            {
              catalogModelName: "Catalog Model",
              requestModelId: "request-model",
              supportedRequestFormats: ["openai"],
            },
          ],
        }),
        expect.objectContaining({
          id: "disabled-member",
          enabled: false,
          modelCapabilities: [],
        }),
      ],
    });
    expect(JSON.stringify(pool)).not.toContain("upstream.example.com");
    expect(JSON.stringify(pool)).not.toContain("openai-key");
    expect(JSON.stringify(pool)).not.toContain("sensitive-upstream-model");
  });

  it("excludes hidden channels from business channel options even for channel managers", async () => {
    permissionService.hasAnyPermission.mockResolvedValue(true);
    relayChannelRepository.listActive.mockResolvedValue([
      { ...sampleChannel, id: "public-channel", visibilityMode: "public" },
      { ...sampleChannel, id: "hidden-channel", visibilityMode: "hidden" },
    ]);
    relayPoolResolver.resolveChannelCapabilities.mockResolvedValue([]);

    const result = await service.listChannelOptions("actor-user");

    expect(result.map((item) => item.id)).toEqual(["public-channel"]);
  });

  it.skip("legacy token-managed pools were removed", async () => {
    permissionService.hasPermission.mockResolvedValue(true);
    relayChannelRepository.listActive.mockResolvedValue([{ ...sampleChannel, id: "public-channel" }]);
    relayTokenRepository.findManagedPoolsByOwnerUserId.mockResolvedValue([
      {
        relayChannelId: "managed-pool-channel",
        relayChannel: { ...sampleChannel, id: "managed-pool-channel", name: "Managed pool" },
      },
    ]);

    const result = await service.listChannelOptions("admin-user", "owner-user");

    expect(relayTokenRepository.findManagedPoolsByOwnerUserId).toHaveBeenCalledWith("owner-user");
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "managed-pool-channel", isManagedPool: true })]),
    );
  });

  it("lists visible channels when includeDisabled is true", async () => {
    relayChannelRepository.listVisible.mockResolvedValue([{ ...sampleChannel, status: RELAY_CHANNEL_STATUS.DISABLED }]);
    relayPoolResolver.resolveEffectiveAllowedModels.mockResolvedValue(["disabled-channel-model"]);

    const result = await service.listChannels("actor-user", true);

    expect(relayChannelRepository.listVisible).toHaveBeenCalled();
    expect(result[0].enabled).toBe(false);
    expect(result[0].allowedModels).toEqual(["disabled-channel-model"]);
    expect(relayPoolResolver.resolveEffectiveAllowedModels).toHaveBeenCalledWith("channel-1", [], {
      includeDisabled: true,
    });
  });

  it("hides private channels from non-manager users", async () => {
    relayChannelRepository.listActive.mockResolvedValue([
      { ...sampleChannel, id: "public-channel", visibilityMode: "public" },
      { ...sampleChannel, id: "private-channel", visibilityMode: "private" },
    ]);

    const result = await service.listChannels("actor-user");

    expect(result.map((item) => item.id)).toEqual(["public-channel"]);
  });

  it("shows private channels to channel managers", async () => {
    permissionService.hasAnyPermission.mockResolvedValue(true);
    relayChannelRepository.listActive.mockResolvedValue([
      { ...sampleChannel, id: "public-channel", visibilityMode: "public" },
      { ...sampleChannel, id: "private-channel", visibilityMode: "private" },
    ]);

    const result = await service.listChannels("actor-user");

    expect(result.map((item) => item.id)).toEqual(["public-channel", "private-channel"]);
  });

  it("shows whitelisted channels to matched users", async () => {
    relayChannelRepository.listActive.mockResolvedValue([
      {
        ...sampleChannel,
        id: "whitelist-channel",
        visibilityMode: "whitelist",
        visibilityConfig: {
          userIds: ["actor-user"],
        },
      },
    ]);

    const result = await service.listChannels("actor-user");

    expect(result.map((item) => item.id)).toEqual(["whitelist-channel"]);
  });

  it("shows whitelisted channels to matched groups", async () => {
    relayChannelRepository.listActive.mockResolvedValue([
      {
        ...sampleChannel,
        id: "group-whitelist-channel",
        visibilityMode: "whitelist",
        visibilityConfig: {
          groupIds: ["group-1"],
        },
      },
    ]);

    const result = await service.listChannels("actor-user");

    expect(result.map((item) => item.id)).toEqual(["group-whitelist-channel"]);
  });

  it("shows whitelisted channels to matched roles", async () => {
    ramRoleRepository.listRoleBindingsForUser.mockResolvedValue([{ roleId: "role-1" }]);
    relayChannelRepository.listActive.mockResolvedValue([
      {
        ...sampleChannel,
        id: "role-whitelist-channel",
        visibilityMode: "whitelist",
        visibilityConfig: {
          roleIds: ["role-1"],
        },
      },
    ]);

    const result = await service.listChannels("actor-user");

    expect(result.map((item) => item.id)).toEqual(["role-whitelist-channel"]);
  });

  it("throws NotFoundError when getting a missing channel", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(null);

    await expect(service.getChannel("missing-id", "actor-user")).rejects.toThrow(NotFoundError);
  });

  it("treats inaccessible private channels as not found", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue({
      ...sampleChannel,
      id: "private-channel",
      visibilityMode: "private",
    });

    await expect(service.getChannel("private-channel", "actor-user")).rejects.toThrow(NotFoundError);
  });

  it("rejects direct business selection of a hidden channel for channel managers", async () => {
    permissionService.hasAnyPermission.mockResolvedValue(true);
    relayChannelRepository.findVisibleById.mockResolvedValue({
      ...sampleChannel,
      id: "hidden-channel",
      visibilityMode: "hidden",
    });

    await expect(service.assertChannelBusinessSelectableById("hidden-channel", "actor-user")).rejects.toThrow(
      "Hidden relay channels can only be used as pooled channel members",
    );
  });

  it("validates channel name on create", async () => {
    await expect(
      service.createChannel(
        {
          name: "   ",
          openaiUpstreamUrl: "https://upstream.example.com",
          openaiUpstreamApiKey: "openai-key",
        },
        "actor-user",
      ),
    ).rejects.toThrow("Channel name is required");
  });

  it("validates multiplier on create", async () => {
    await expect(
      service.createChannel(
        {
          name: "Channel",
          openaiUpstreamUrl: "https://upstream.example.com",
          openaiUpstreamApiKey: "openai-key",
          multiplier: -1,
        },
        "actor-user",
      ),
    ).rejects.toThrow("multiplier must be >= 0");
  });

  it("ignores a submitted multiplier when validating a pooled channel", async () => {
    const validated = await (service as any).buildValidatedChannelData({
      name: "Pooled Channel",
      channelType: "pooled",
      multiplier: 42,
      poolMembers: [{ memberChannelId: "member-channel", priority: 1, enabled: true }],
    });

    expect(validated.multiplier).toBe(1);
  });

  it("validates allowedFormats and allowedModels on create", async () => {
    await expect(
      service.createChannel(
        {
          name: "Channel",
          openaiUpstreamUrl: "https://upstream.example.com",
          openaiUpstreamApiKey: "openai-key",
          allowedFormats: "both",
        },
        "actor-user",
      ),
    ).rejects.toThrow("allowedFormats 'both' is deprecated");

    await expect(
      service.createChannel(
        {
          name: "Channel",
          openaiUpstreamUrl: "https://upstream.example.com",
          openaiUpstreamApiKey: "openai-key",
          allowedFormats: "invalid-format",
        },
        "actor-user",
      ),
    ).rejects.toThrow("Invalid format");

    await expect(
      service.createChannel(
        {
          name: "Channel",
          openaiUpstreamUrl: "https://upstream.example.com",
          openaiUpstreamApiKey: "openai-key",
          allowedModels: "not-json",
        },
        "actor-user",
      ),
    ).rejects.toThrow("allowedModels must be a valid JSON array");
  });

  it("requires at least one upstream URL on create", async () => {
    await expect(
      service.createChannel(
        {
          name: "Channel",
        },
        "actor-user",
      ),
    ).rejects.toThrow("At least one upstream URL");
  });

  it("creates a channel with defaults", async () => {
    relayChannelRepository.create.mockResolvedValue(sampleChannel);

    const result = await service.createChannel(
      {
        name: "Main",
        openaiUpstreamUrl: "https://upstream.example.com",
        openaiUpstreamApiKey: "openai-key",
        allowedFormats: "openai",
      },
      "actor-user",
    );

    expect(result.id).toBe("channel-1");
    expect(relayChannelRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Main",
        multiplier: 1,
        addUserIdentifier: true,
        inputTokensIncludeCacheRead: false,
      }),
      transactionClient,
    );
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: OperationType.RELAY_CHANNEL_CREATE,
        actorUserId: "actor-user",
        ipAddress: "unknown",
        changes: expect.objectContaining({
          openaiUpstreamApiKey: "***MASKED***",
        }),
      }),
    );
  });

  it("creates pooled channel with auto allowed models mode and syncs members", async () => {
    relayChannelRepository.create.mockResolvedValue({
      ...sampleChannel,
      id: "pooled-channel-1",
      name: "Pool",
      channelType: "pooled",
      routingStrategy: "round-robin",
      routingConfig: {
        maxRetries: 2,
        allowedModelsMode: "auto",
        healthScoreThreshold: null,
      },
      allowedFormats: "openai",
    });

    const result = await service.createChannel(
      {
        name: "Pool",
        channelType: "pooled",
        routingStrategy: "round-robin",
        allowedFormats: "all",
        routingConfig: {
          maxRetries: 2,
          allowedModelsMode: "auto",
          healthScoreThreshold: null,
        },
        poolMembers: [
          {
            memberChannelId: "member-1",
            priority: 1,
            weight: 3,
            enabled: true,
          },
        ],
      },
      "actor-user",
    );

    expect(result.id).toBe("pooled-channel-1");
    expect(relayChannelRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channelType: "pooled",
        routingStrategy: "round-robin",
        routingConfig: expect.objectContaining({
          maxRetries: 2,
          allowedModelsMode: "auto",
          healthScoreThreshold: null,
        }),
        allowedFormats: "all",
      }),
      transactionClient,
    );
    expect(relayChannelRepository.replaceMembersByChannelId).toHaveBeenCalledWith(
      "pooled-channel-1",
      [
        {
          memberChannelId: "member-1",
          priority: 1,
          weight: 3,
          enabled: true,
        },
      ],
      transactionClient,
    );
  });

  it("rejects pooled channels with nonexistent members before persistence", async () => {
    relayChannelRepository.listVisibleByIds.mockResolvedValue([]);
    relayChannelRepository.create.mockResolvedValue({
      ...sampleChannel,
      id: "pooled-channel-1",
      channelType: "pooled",
    });

    await expect(
      service.createChannel(
        {
          name: "Pool",
          channelType: "pooled",
          poolMembers: [{ memberChannelId: "missing-member", priority: 0 }],
        },
        "actor-user",
      ),
    ).rejects.toThrow("One or more pooled channel members were not found");

    expect(relayChannelRepository.replaceMembersByChannelId).not.toHaveBeenCalled();
  });

  it("rejects pooled or automatic-pool members in an automatic proxy pool", async () => {
    relayChannelRepository.listVisibleByIds.mockResolvedValue([
      { ...sampleChannel, id: "ordinary-pool", channelType: "pooled" },
    ]);
    relayChannelRepository.create.mockResolvedValue({
      ...sampleChannel,
      id: "automatic-pool",
      channelType: "automatic-proxy-pool",
    });

    await expect(
      service.createChannel(
        {
          name: "Automatic pool",
          channelType: "automatic-proxy-pool",
          poolMembers: [{ memberChannelId: "ordinary-pool", priority: 0, weight: 1, enabled: true }],
        },
        "actor-user",
      ),
    ).rejects.toThrow("automatic proxy pool members must be standalone channels");
    expect(relayChannelRepository.replaceMembersByChannelId).not.toHaveBeenCalled();
  });

  it("uses member-derived formats for automatic proxy pools", async () => {
    relayChannelRepository.listVisibleByIds.mockResolvedValue([
      { ...sampleChannel, id: "member", channelType: "standalone" },
    ]);
    relayChannelRepository.create.mockResolvedValue({
      ...sampleChannel,
      id: "automatic-pool",
      channelType: "automatic-proxy-pool",
      allowedFormats: "all",
    });

    await service.createChannel(
      {
        name: "Automatic pool",
        channelType: "automatic-proxy-pool",
        allowedFormats: "openai",
        poolMembers: [{ memberChannelId: "member", priority: 0, weight: 1, enabled: true }],
      },
      "actor-user",
    );

    expect(relayChannelRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ allowedFormats: "all" }),
      transactionClient,
    );
  });

  it("returns effective member formats instead of the pool's neutral all value", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue({
      ...sampleChannel,
      id: "automatic-pool",
      channelType: "automatic-proxy-pool",
      allowedFormats: "all",
    });
    relayPoolResolver.resolveChannelCapabilities.mockResolvedValue([
      { supportedRequestFormats: ["openai"] },
      { supportedRequestFormats: ["anthropic", "openai"] },
    ]);

    await expect(service.getChannel("automatic-pool", "actor-user")).resolves.toMatchObject({
      allowedFormats: "openai,anthropic",
    });
  });

  it("remaps imported pooled members to newly created channel IDs", async () => {
    relayChannelRepository.create
      .mockResolvedValueOnce({ ...sampleChannel, id: "target-pool", name: "Pool", channelType: "pooled" })
      .mockResolvedValueOnce({ ...sampleChannel, id: "target-member", name: "Member" });
    relayChannelRepository.listVisibleByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ ...sampleChannel, id })),
    );

    await service.importChannels(
      {
        channels: [
          {
            id: "source-pool",
            name: "Pool",
            channelType: "pooled",
            allowedFormats: "openai",
            poolMembers: [{ memberChannelId: "source-member", priority: 1, weight: 1, enabled: true }],
          },
          {
            id: "source-member",
            name: "Member",
            openaiUpstreamUrl: "https://upstream.example.com",
            openaiUpstreamApiKey: "openai-key",
            allowedFormats: "openai",
          },
        ],
      },
      "actor-user",
    );

    expect(relayChannelRepository.replaceMembersByChannelId).toHaveBeenCalledWith(
      "target-pool",
      [{ memberChannelId: "target-member", priority: 1, weight: 1, enabled: true }],
      transactionClient,
    );
  });

  it("allows an imported pool to reference an existing destination member", async () => {
    relayChannelRepository.create.mockResolvedValue({
      ...sampleChannel,
      id: "target-pool",
      name: "Pool",
      channelType: "pooled",
    });
    relayChannelRepository.listVisible.mockResolvedValue([
      { ...sampleChannel, id: "existing-destination-member", name: "Existing member" },
    ]);
    relayChannelRepository.listVisibleByIds.mockResolvedValue([
      { ...sampleChannel, id: "existing-destination-member", channelType: "standalone" },
    ]);

    await service.importChannels(
      {
        channels: [
          {
            id: "source-pool",
            name: "Pool",
            channelType: "pooled",
            allowedFormats: "openai",
            poolMembers: [
              {
                memberChannelId: "source-member-not-in-payload",
                memberChannelName: "Existing member",
                priority: 1,
                weight: 1,
                enabled: true,
              },
            ],
          },
        ],
      },
      "actor-user",
    );

    expect(relayChannelRepository.replaceMembersByChannelId).toHaveBeenCalledWith(
      "target-pool",
      [{ memberChannelId: "existing-destination-member", priority: 1, weight: 1, enabled: true }],
      transactionClient,
    );
  });

  it("throws NotFoundError on update for missing channel", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(null);

    await expect(service.updateChannel("missing-id", { name: "new-name" }, "actor-user")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("updates an existing channel", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(sampleChannel);
    relayChannelRepository.updateById.mockResolvedValue({
      ...sampleChannel,
      name: "Updated",
      multiplier: 1.5,
      allowedFormats: "openai,gemini",
    });

    const result = await service.updateChannel(
      "channel-1",
      {
        name: "Updated",
        multiplier: 1.5,
        allowedFormats: "openai,gemini",
        geminiUpstreamUrl: "https://gemini.example.com",
        geminiUpstreamApiKey: "gemini-key",
      },
      "actor-user",
    );

    expect(result.name).toBe("Updated");
    expect(relayChannelRepository.updateById).toHaveBeenCalledWith(
      "channel-1",
      expect.objectContaining({ name: "Updated", multiplier: 1.5 }),
      transactionClient,
    );
  });

  it("clears visibility configuration when a channel becomes hidden", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue({
      ...sampleChannel,
      visibilityMode: "whitelist",
      visibilityConfig: { userIds: ["user-1"] },
    });
    relayChannelRepository.countDirectBusinessReferences.mockResolvedValue(0);
    relayChannelRepository.updateById.mockResolvedValue({
      ...sampleChannel,
      visibilityMode: "hidden",
      visibilityConfig: null,
    });

    await service.updateChannel("channel-1", { visibilityMode: "hidden" }, "actor-user");

    expect(relayChannelRepository.updateById).toHaveBeenCalledWith(
      "channel-1",
      expect.objectContaining({ visibilityMode: "hidden", visibilityConfig: expect.anything() }),
      transactionClient,
    );
  });

  it("rejects hiding a channel with direct business references", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(sampleChannel);
    relayChannelRepository.countDirectBusinessReferences.mockResolvedValue(1);

    await expect(service.updateChannel("channel-1", { visibilityMode: "hidden" }, "actor-user")).rejects.toThrow(
      "Cannot hide a relay channel while it is directly assigned",
    );
    expect(relayChannelRepository.updateById).not.toHaveBeenCalled();
  });

  it("preserves explicit null routing thresholds and standalone health tracking on update", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue({
      ...sampleChannel,
      routingConfig: {
        healthScoreThreshold: 80,
        latencyThresholdMs: 1000,
        circuitBreakerThreshold: 5,
      },
    });
    relayChannelRepository.updateById.mockResolvedValue({
      ...sampleChannel,
      routingConfig: {
        healthScoreThreshold: null,
        latencyThresholdMs: null,
        circuitBreakerThreshold: null,
      },
    });

    await service.updateChannel(
      "channel-1",
      {
        routingConfig: {
          healthScoreThreshold: null,
          latencyThresholdMs: null,
          circuitBreakerThreshold: null,
          healthTrackingMode: "automatic",
          manualAvailability: null,
          manualLatencyMs: null,
          allowedModelsMode: "auto",
        },
      },
      "actor-user",
    );

    expect(relayChannelRepository.updateById).toHaveBeenCalledWith(
      "channel-1",
      expect.objectContaining({
        routingConfig: {
          healthScoreThreshold: null,
          latencyThresholdMs: null,
          circuitBreakerThreshold: null,
          healthTrackingMode: "automatic",
          manualAvailability: null,
          manualLatencyMs: null,
        },
      }),
      transactionClient,
    );
  });

  it("rejects pooled channel update when pool contains itself", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue({
      ...sampleChannel,
      id: "channel-1",
      channelType: "pooled",
    });

    await expect(
      service.updateChannel(
        "channel-1",
        {
          channelType: "pooled",
          poolMembers: [
            {
              memberChannelId: "channel-1",
              priority: 1,
              weight: 1,
              enabled: true,
            },
          ],
        },
        "actor-user",
      ),
    ).rejects.toThrow("pooled channel cannot include itself as a member");

    expect(relayChannelRepository.updateById).not.toHaveBeenCalled();
  });

  it("rejects pooled channel update when all members are cleared", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue({
      ...sampleChannel,
      id: "channel-1",
      channelType: "pooled",
    });

    await expect(
      service.updateChannel(
        "channel-1",
        {
          channelType: "pooled",
          poolMembers: [],
        },
        "actor-user",
      ),
    ).rejects.toThrow("pooled channel must contain at least one member");

    expect(relayChannelRepository.updateById).not.toHaveBeenCalled();
    expect(relayChannelRepository.replaceMembersByChannelId).not.toHaveBeenCalled();
  });

  it("toggles channel status between enabled and disabled", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(sampleChannel);
    relayChannelRepository.updateById.mockResolvedValue({
      ...sampleChannel,
      status: RELAY_CHANNEL_STATUS.DISABLED,
    });

    const result = await service.toggleChannelStatus("channel-1", "actor-user");

    expect(relayChannelRepository.updateById).toHaveBeenCalledWith("channel-1", {
      status: RELAY_CHANNEL_STATUS.DISABLED,
    });
    expect(result.enabled).toBe(false);
  });

  it("toggles channel status from disabled back to enabled", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue({
      ...sampleChannel,
      status: RELAY_CHANNEL_STATUS.DISABLED,
    });
    relayChannelRepository.updateById.mockResolvedValue(sampleChannel);

    const result = await service.toggleChannelStatus("channel-1", "actor-user");

    expect(relayChannelRepository.updateById).toHaveBeenCalledWith("channel-1", {
      status: RELAY_CHANNEL_STATUS.ENABLED,
    });
    expect(result.enabled).toBe(true);
  });

  it("throws NotFoundError when toggling a deleted channel", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue({
      ...sampleChannel,
      status: RELAY_CHANNEL_STATUS.DELETED,
    });

    await expect(service.toggleChannelStatus("channel-1", "actor-user")).rejects.toThrow(NotFoundError);
    expect(relayChannelRepository.updateById).not.toHaveBeenCalled();
  });

  it("throws NotFoundError on delete for missing channel", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(null);

    await expect(service.deleteChannel("missing-id", "actor-user")).rejects.toThrow(NotFoundError);
  });

  it("soft deletes existing channel", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(sampleChannel);

    await service.deleteChannel("channel-1", "actor-user");

    expect(relayChannelRepository.softDeleteAndUnassignTokens).toHaveBeenCalledWith("channel-1");
  });

  it("batch deletes channels through the repository cleanup transaction", async () => {
    relayChannelRepository.softDeleteAndUnassignTokensByIds.mockResolvedValue(2);

    const result = await service.batchDeleteChannels({ ids: ["automatic-pool-1", "automatic-pool-2"] }, "actor-user");

    expect(relayChannelRepository.softDeleteAndUnassignTokensByIds).toHaveBeenCalledWith([
      "automatic-pool-1",
      "automatic-pool-2",
    ]);
    expect(result).toEqual({ total: 2, affected: 2 });
  });

  it("batch disabling channels only changes their status and does not invoke deletion cleanup", async () => {
    relayChannelRepository.updateStatusByIds.mockResolvedValue(1);

    const result = await service.batchSetChannelStatus({ ids: ["automatic-pool-1"], enabled: false }, "actor-user");

    expect(relayChannelRepository.updateStatusByIds).toHaveBeenCalledWith(
      ["automatic-pool-1"],
      RELAY_CHANNEL_STATUS.DISABLED,
    );
    expect(relayChannelRepository.softDeleteAndUnassignTokensByIds).not.toHaveBeenCalled();
    expect(result).toEqual({ total: 1, affected: 1 });
  });

  it("creates a channel with inputTokensIncludeCacheRead set to false", () => {
    // This test is now redundant since false is the default, but keeping for clarity
  });

  it("creates a channel with inputTokensIncludeCacheRead set to true", async () => {
    const channelWithCacheReadTrue = { ...sampleChannel, inputTokensIncludeCacheRead: true };
    relayChannelRepository.create.mockResolvedValue(channelWithCacheReadTrue);

    const result = await service.createChannel(
      {
        name: "Main",
        openaiUpstreamUrl: "https://upstream.example.com",
        openaiUpstreamApiKey: "openai-key",
        allowedFormats: "openai",
        inputTokensIncludeCacheRead: true,
      },
      "actor-user",
    );

    expect(result.inputTokensIncludeCacheRead).toBe(true);
    expect(relayChannelRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokensIncludeCacheRead: true,
      }),
      transactionClient,
    );
  });

  it("defaults inputTokensIncludeCacheRead to false when not specified", async () => {
    relayChannelRepository.create.mockResolvedValue(sampleChannel);

    await service.createChannel(
      {
        name: "Main",
        openaiUpstreamUrl: "https://upstream.example.com",
        openaiUpstreamApiKey: "openai-key",
        allowedFormats: "openai",
      },
      "actor-user",
    );

    expect(relayChannelRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokensIncludeCacheRead: false,
      }),
      transactionClient,
    );
  });

  it("updates inputTokensIncludeCacheRead field", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(sampleChannel);
    const updatedChannel = { ...sampleChannel, inputTokensIncludeCacheRead: true };
    relayChannelRepository.updateById.mockResolvedValue(updatedChannel);

    const result = await service.updateChannel(
      "channel-1",
      {
        inputTokensIncludeCacheRead: true,
      },
      "actor-user",
    );

    expect(result.inputTokensIncludeCacheRead).toBe(true);
    expect(relayChannelRepository.updateById).toHaveBeenCalledWith(
      "channel-1",
      expect.objectContaining({
        inputTokensIncludeCacheRead: true,
      }),
      transactionClient,
    );
  });

  it("serializes inputTokensIncludeCacheRead correctly in toDto", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(sampleChannel);

    const result = await service.getChannel("channel-1", "actor-user");

    expect(result.inputTokensIncludeCacheRead).toBe(false);
  });

  it("serializes inputTokensIncludeCacheRead as true when field is true in database", async () => {
    const channelWithTrue = { ...sampleChannel, inputTokensIncludeCacheRead: true };
    relayChannelRepository.findVisibleById.mockResolvedValue(channelWithTrue);

    const result = await service.getChannel("channel-1", "actor-user");

    expect(result.inputTokensIncludeCacheRead).toBe(true);
  });
});
