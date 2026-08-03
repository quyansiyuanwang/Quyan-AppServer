import { beforeEach, describe, expect, it, vi } from "vitest";
import { RelayTokenService } from "../../../src/services/relay/relay-token.service";
import { MANAGED_STATUS } from "../../../src/constant/status";
import { ForbiddenError, NotFoundError } from "../../../src/util/errors";
import { translateMessage } from "../../../src/locales";

describe("RelayTokenService", () => {
  const relayTokenRepository = {
    create: vi.fn(),
    findByUserIdWithRelations: vi.fn(),
    findPageWithRelations: vi.fn(),
    findUsageSummaryTargets: vi.fn(),
    findUsageSummaryTargetsByIds: vi.fn(),
    findByIdWithRelations: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    withTransaction: vi.fn(),
    withSerializableTransaction: vi.fn(),
    findManagedPoolByRelayTokenId: vi.fn(),
    findManagedPoolsByOwnerUserId: vi.fn(),
    findChannelConfiguration: vi.fn(),
    upsertManagedPool: vi.fn(),
    replaceChannelConfigs: vi.fn(),
  };

  const relayUsageRepository = {
    findByRelayTokenId: vi.fn(),
    aggregateByRelayTokenIds: vi.fn(),
    findUsageDetailPageByRelayTokenId: vi.fn(),
  };

  const modelPricingRepository = {
    listActiveOrderedByModel: vi.fn(),
  };

  const balanceRepository = {
    findAccountByUserId: vi.fn(),
  };

  const businessLogService = {
    logOperation: vi.fn(),
  };

  const relayChannelRepository = {
    listActiveByIds: vi.fn(),
    listVisible: vi.fn(),
    replaceMembersByChannelId: vi.fn(),
  };

  const relayProxyService = {
    getAvailableModelsForToken: vi.fn(),
  };

  const configService = {
    getConfig: vi.fn(),
  };

  const permissionService = {
    hasPermission: vi.fn().mockResolvedValue(false),
  };

  const rateLimiterService = {
    assertNamedBackoffRateLimit: vi.fn(),
    markNamedBackoffRateLimitFailure: vi.fn(),
    clearNamedBackoffRateLimit: vi.fn(),
  };

  const relayChannelService = {
    assertChannelAccessibleById: vi.fn(),
    assertChannelBusinessSelectableById: vi.fn(),
  };

  const RelayTokenServiceCtor = RelayTokenService as unknown as new (...args: any[]) => RelayTokenService;

  const service = new RelayTokenServiceCtor(
    relayTokenRepository,
    relayUsageRepository,
    modelPricingRepository,
    businessLogService,
    relayChannelRepository,
    relayProxyService,
    balanceRepository,
    configService,
    permissionService,
    rateLimiterService,
    relayChannelService,
  );

  const now = new Date("2026-01-01T00:00:00.000Z");

  const createToken = (overrides: Record<string, any> = {}) => ({
    id: "token-1",
    userId: "user-1",
    name: "Primary Token",
    token: "rlt_token_1",
    balance: 0,
    totalTokens: 0,
    requestCount: 0,
    usedQuota: 0,
    channelId: "channel-1",
    expiresAt: null,
    lastUsedAt: null,
    createTime: now,
    status: MANAGED_STATUS.ENABLED,
    quotaLimit: 100,
    quotaWindows: [],
    allowedModels: null,
    channel: { id: "channel-1", name: "Main Channel" },
    failoverConfig: null,
    channelConfigs: [],
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    relayChannelService.assertChannelAccessibleById.mockResolvedValue({ id: "channel-1" });
    relayChannelService.assertChannelBusinessSelectableById.mockResolvedValue({ id: "channel-1" });
    relayTokenRepository.findManagedPoolsByOwnerUserId.mockResolvedValue([]);
    relayTokenRepository.findChannelConfiguration.mockResolvedValue({ channelId: "channel-1", channelConfigs: [] });
    relayChannelRepository.listVisible.mockResolvedValue([]);
    relayTokenRepository.withTransaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({}),
    );
    relayTokenRepository.withSerializableTransaction.mockImplementation(
      async (callback: (tx: any) => Promise<unknown>) => callback({}),
    );
  });

  it.skip("legacy managed pool attachment was replaced by shared automatic proxy pools", async () => {
    const token = createToken({
      channelConfigs: [
        { channelId: "channel-primary", priority: 0 },
        { channelId: "channel-backup", priority: 1 },
      ],
    });
    const managedPool = {
      relayChannelId: "managed-pool-channel",
      relayChannel: {
        id: "managed-pool-channel",
        name: "Managed pool",
        routingStrategy: "priority",
        routingConfig: null,
        poolMembers: [{ memberChannelId: "channel-member", priority: 0, weight: 1, enabled: true }],
      },
    };
    const attachedManagedPool = {
      ...managedPool,
      relayToken: {
        channelConfigs: [
          { channelId: "channel-primary" },
          { channelId: "channel-backup" },
          { channelId: "managed-pool-channel" },
        ],
      },
    };
    relayTokenRepository.findByIdWithRelations.mockResolvedValue(token);
    relayChannelRepository.listActiveByIds.mockResolvedValue([{ id: "channel-member" }]);
    relayTokenRepository.findManagedPoolByRelayTokenId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(attachedManagedPool);
    relayTokenRepository.upsertManagedPool.mockResolvedValue(managedPool);
    relayTokenRepository.findChannelConfiguration.mockResolvedValue({
      channelId: "channel-primary",
      channelConfigs: [
        { channelId: "channel-primary", priority: 0 },
        { channelId: "channel-backup", priority: 1 },
      ],
    });

    const result = await (service as any).updateManagedPool("token-1", "user-1", {
      attachToToken: true,
      members: [{ memberChannelId: "channel-member", priority: 0, weight: 1, enabled: true }],
    });

    expect(relayTokenRepository.replaceChannelConfigs).toHaveBeenCalledWith(
      "token-1",
      "channel-primary",
      [
        { channelId: "channel-primary", priority: 0 },
        { channelId: "channel-backup", priority: 1 },
        { channelId: "managed-pool-channel", priority: 2 },
      ],
      expect.anything(),
    );
    expect(result.attachedToToken).toBe(true);
  });

  it.skip("legacy managed pool attachment was replaced by shared automatic proxy pools", async () => {
    const token = createToken({
      channelConfigs: [
        { channelId: "channel-primary", priority: 0 },
        { channelId: "managed-pool-channel", priority: 1 },
      ],
    });
    const managedPool = {
      relayChannelId: "managed-pool-channel",
      relayToken: { channelConfigs: [{ channelId: "channel-primary" }, { channelId: "managed-pool-channel" }] },
      relayChannel: {
        id: "managed-pool-channel",
        name: "Managed pool",
        routingStrategy: "priority",
        routingConfig: null,
        poolMembers: [{ memberChannelId: "channel-member", priority: 0, weight: 1, enabled: true }],
      },
    };
    relayTokenRepository.findByIdWithRelations.mockResolvedValue(token);
    relayChannelRepository.listActiveByIds.mockResolvedValue([{ id: "channel-member" }]);
    relayTokenRepository.findManagedPoolByRelayTokenId.mockResolvedValue(managedPool);
    relayTokenRepository.upsertManagedPool.mockResolvedValue(managedPool);
    relayTokenRepository.findChannelConfiguration.mockResolvedValue({
      channelId: "channel-primary",
      channelConfigs: [
        { channelId: "channel-primary", priority: 0 },
        { channelId: "managed-pool-channel", priority: 1 },
      ],
    });

    const result = await (service as any).updateManagedPool("token-1", "user-1", {
      attachToToken: true,
      members: [{ memberChannelId: "channel-member", priority: 0, weight: 1, enabled: true }],
    });

    expect(relayTokenRepository.replaceChannelConfigs).not.toHaveBeenCalled();
    expect(result.attachedToToken).toBe(true);
  });

  it.skip("legacy managed pool attachment was replaced by shared automatic proxy pools", async () => {
    const token = createToken();
    const managedPool = {
      relayChannelId: "managed-pool-channel",
      relayChannel: {
        id: "managed-pool-channel",
        name: "Managed pool",
        routingStrategy: "priority",
        routingConfig: null,
        poolMembers: [],
      },
    };
    relayTokenRepository.findByIdWithRelations.mockResolvedValue(token);
    relayChannelRepository.listActiveByIds.mockResolvedValue([{ id: "other-pool" }]);
    relayTokenRepository.findManagedPoolByRelayTokenId.mockResolvedValue(null);
    relayTokenRepository.upsertManagedPool.mockResolvedValue(managedPool);
    relayChannelRepository.listVisible.mockResolvedValue([
      { id: "managed-pool-channel", poolMembers: [{ memberChannelId: "other-pool" }] },
      { id: "other-pool", poolMembers: [{ memberChannelId: "managed-pool-channel" }] },
    ]);

    await expect(
      (service as any).updateManagedPool("token-1", "user-1", {
        members: [{ memberChannelId: "other-pool", priority: 0, weight: 1, enabled: true }],
      }),
    ).rejects.toThrow("indirect cycle");
  });

  it("rejects binding a token to an inaccessible relay channel", async () => {
    relayChannelRepository.listActiveByIds.mockResolvedValue([{ id: "channel-private" }]);
    relayChannelService.assertChannelBusinessSelectableById.mockRejectedValue(
      new NotFoundError("Relay channel not found"),
    );

    await expect(
      service.generateToken("user-1", {
        name: "Token",
        channelId: "channel-private",
      } as any),
    ).rejects.toThrow(NotFoundError);

    expect(relayChannelService.assertChannelBusinessSelectableById).toHaveBeenCalledWith("channel-private", "user-1");
  });

  it("rejects binding a token to an inaccessible automatic proxy pool", async () => {
    relayChannelService.assertChannelAccessibleById.mockRejectedValue(new NotFoundError("Relay channel not found"));

    await expect(
      service.generateToken("user-1", {
        name: "Automatic Token",
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: "private-automatic-pool",
      } as any),
    ).rejects.toThrow(NotFoundError);

    expect(relayChannelService.assertChannelAccessibleById).toHaveBeenCalledWith("private-automatic-pool", "user-1");
    expect(relayChannelService.assertChannelBusinessSelectableById).not.toHaveBeenCalled();
  });

  it("rejects a non-automatic channel selected as an automatic proxy pool", async () => {
    relayChannelService.assertChannelAccessibleById.mockResolvedValue({
      id: "channel-1",
      status: MANAGED_STATUS.ENABLED,
      channelType: "standalone",
    });

    await expect(
      service.generateToken("user-1", {
        name: "Automatic Token",
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: "channel-1",
      } as any),
    ).rejects.toThrow("Automatic proxy pool not found or unavailable");
  });

  it("rejects blocked channels outside the automatic pool and blocking every member", async () => {
    relayChannelService.assertChannelAccessibleById.mockResolvedValue({
      id: "automatic-pool",
      status: MANAGED_STATUS.ENABLED,
      channelType: "automatic-proxy-pool",
      poolMembers: [
        {
          memberChannelId: "member-1",
          enabled: true,
          memberChannel: { status: MANAGED_STATUS.ENABLED },
        },
        {
          memberChannelId: "member-2",
          enabled: true,
          memberChannel: { status: MANAGED_STATUS.ENABLED },
        },
      ],
    });

    await expect(
      service.generateToken("user-1", {
        name: "Automatic Token",
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: "automatic-pool",
        blockedAutomaticProxyPoolChannelIds: ["not-a-member"],
      } as any),
    ).rejects.toThrow("Blocked channels must be enabled members of the selected automatic proxy pool");

    await expect(
      service.generateToken("user-1", {
        name: "Automatic Token",
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: "automatic-pool",
        blockedAutomaticProxyPoolChannelIds: ["member-1", "member-2"],
      } as any),
    ).rejects.toThrow("At least one automatic proxy pool channel must remain available");
  });

  it("rejects disabled automatic proxy pool members as blockable channels", async () => {
    relayChannelService.assertChannelAccessibleById.mockResolvedValue({
      id: "automatic-pool",
      status: MANAGED_STATUS.ENABLED,
      channelType: "automatic-proxy-pool",
      poolMembers: [
        {
          memberChannelId: "member-enabled",
          enabled: true,
          memberChannel: { status: MANAGED_STATUS.ENABLED },
        },
        {
          memberChannelId: "member-disabled",
          enabled: false,
          memberChannel: { status: MANAGED_STATUS.ENABLED },
        },
      ],
    });

    await expect(
      service.generateToken("user-1", {
        name: "Automatic Token",
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: "automatic-pool",
        blockedAutomaticProxyPoolChannelIds: ["member-disabled"],
      } as any),
    ).rejects.toThrow("Blocked channels must be enabled members of the selected automatic proxy pool");
  });

  it("rejects an automatic proxy pool in ordered channel configuration", async () => {
    relayChannelRepository.listActiveByIds.mockResolvedValue([
      { id: "automatic-pool", channelType: "automatic-proxy-pool" },
    ]);

    await expect(
      service.generateToken("user-1", {
        name: "Ordered Token",
        channelConfigs: [{ channelId: "automatic-pool", priority: 0 }],
      } as any),
    ).rejects.toThrow("Automatic proxy pools can only be configured in automatic routing mode");

    expect(relayChannelService.assertChannelBusinessSelectableById).not.toHaveBeenCalled();
  });

  it("preserves multi-channel routing on metadata-only updates", async () => {
    const token = createToken({
      channelConfigs: [
        { channelId: "channel-1", priority: 0 },
        { channelId: "channel-2", priority: 1 },
      ],
      failoverConfig: { enabled: true, maxRetries: 1 },
    });
    relayTokenRepository.findByIdWithRelations.mockResolvedValue(token);
    relayTokenRepository.update.mockResolvedValue(undefined);

    await service.updateToken("token-1", "user-1", { name: "Renamed" });

    expect(relayTokenRepository.update).toHaveBeenCalledWith(
      "token-1",
      expect.objectContaining({
        name: "Renamed",
        channelId: undefined,
        channelConfigs: undefined,
        failoverConfig: undefined,
      }),
    );
    expect(relayChannelService.assertChannelBusinessSelectableById).not.toHaveBeenCalled();
  });

  it("returns persisted usage summaries for all user tokens without live aggregation", async () => {
    const limitedToken = createToken({
      id: "token-1",
      name: "Limited Token",
      quotaLimit: 100,
      usedQuota: 25,
      requestCount: 4,
      totalTokens: 400,
      lastUsedAt: now,
    });
    const unlimitedToken = createToken({ id: "token-2", name: "Unlimited Token", quotaLimit: null });

    relayTokenRepository.findUsageSummaryTargets.mockResolvedValue([limitedToken, unlimitedToken]);

    const result = await service.getUsageSummaries("user-1");

    expect(relayUsageRepository.aggregateByRelayTokenIds).not.toHaveBeenCalled();
    expect(result.summaries).toEqual([
      {
        relayTokenId: "token-1",
        tokenName: "Limited Token",
        quotaLimit: 100,
        usedQuota: 25,
        remainingQuota: 75,
        quotaUsagePercent: 25,
        isQuotaExceeded: false,
        requestCount: 4,
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 400,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        chargedAmount: 0,
        coveredAmount: 0,
        totalSpend: 0,
        rangeMode: undefined,
        rangeLabel: undefined,
        rangeStartAt: undefined,
        rangeEndAt: undefined,
        lastUsedAt: now,
      },
      {
        relayTokenId: "token-2",
        tokenName: "Unlimited Token",
        quotaLimit: undefined,
        usedQuota: 0,
        remainingQuota: undefined,
        quotaUsagePercent: undefined,
        isQuotaExceeded: false,
        requestCount: 0,
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        chargedAmount: 0,
        coveredAmount: 0,
        totalSpend: 0,
        rangeMode: undefined,
        rangeLabel: undefined,
        rangeStartAt: undefined,
        rangeEndAt: undefined,
        lastUsedAt: undefined,
      },
    ]);
  });

  it("lists tokens without losing service context during DTO mapping", async () => {
    relayTokenRepository.findPageWithRelations.mockResolvedValue({
      items: [
        createToken({
          quotaWindows: [
            {
              id: "quota-window-1",
              quotaLimit: 12.5,
              quotaUnit: "amount",
              quotaWindowHours: 24,
            },
            {
              id: "quota-window-2",
              quotaLimit: 2,
              quotaUnit: "request",
              quotaWindowHours: 24,
            },
          ],
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    relayUsageRepository.aggregateByRelayTokenIds.mockResolvedValue([
      {
        relayTokenId: "token-1",
        requestCount: 3,
        requestTokens: 120,
        responseTokens: 180,
        totalTokens: 300,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        chargedAmount: 6.25,
        coveredAmount: 0,
        lastUsedAt: undefined,
      },
    ]);

    const result = await service.listTokens("user-1");

    expect(relayTokenRepository.findPageWithRelations).toHaveBeenCalledWith(1, 20, "user-1");
    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: "token-1",
          quotaWindows: [
            {
              id: "quota-window-1",
              quotaLimit: 12.5,
              quotaUnit: "amount",
              quotaWindowHours: 24,
              usedQuota: 6.25,
              remainingQuota: 6.25,
              quotaUsagePercent: 50,
              isQuotaExceeded: false,
            },
            {
              id: "quota-window-2",
              quotaLimit: 2,
              quotaUnit: "request",
              quotaWindowHours: 24,
              usedQuota: 3,
              remainingQuota: 0,
              quotaUsagePercent: 150,
              isQuotaExceeded: true,
            },
          ],
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it("uses backend i18n key when denying relay token management for another user", async () => {
    permissionService.hasPermission.mockResolvedValue(false);

    await expect(service.listTokens("user-1", 1, 20, "other-user")).rejects.toMatchObject({
      messageKey: "relay.manageOthersPermissionDenied",
    });
    expect(translateMessage("relay.manageOthersPermissionDenied", "zh-CN")).toBe("你没有权限管理其他用户的中转令牌");
    expect(translateMessage("relay.manageOthersPermissionDenied", "en")).toBe(
      "You do not have permission to manage other users' relay tokens",
    );
    expect(relayTokenRepository.findPageWithRelations).not.toHaveBeenCalled();
  });

  it("reuses window aggregates across tokens and zero-fills missing usage rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    relayTokenRepository.findPageWithRelations.mockResolvedValue({
      items: [
        createToken({
          id: "token-1",
          quotaWindows: [
            {
              id: "quota-window-24-amount",
              quotaLimit: 10,
              quotaUnit: "amount",
              quotaWindowHours: 24,
            },
            {
              id: "quota-window-48-request",
              quotaLimit: 5,
              quotaUnit: "request",
              quotaWindowHours: 48,
            },
          ],
        }),
        createToken({
          id: "token-2",
          name: "Secondary Token",
          quotaWindows: [
            {
              id: "quota-window-24-token",
              quotaLimit: 200,
              quotaUnit: "token",
              quotaWindowHours: 24,
            },
          ],
        }),
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });
    relayUsageRepository.aggregateByRelayTokenIds
      .mockResolvedValueOnce([
        {
          relayTokenId: "token-1",
          requestCount: 1,
          requestTokens: 40,
          responseTokens: 60,
          totalTokens: 100,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          chargedAmount: 5,
          coveredAmount: 0,
          lastUsedAt: now,
        },
      ])
      .mockResolvedValueOnce([
        {
          relayTokenId: "token-1",
          requestCount: 4,
          requestTokens: 100,
          responseTokens: 200,
          totalTokens: 300,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          chargedAmount: 6,
          coveredAmount: 0,
          lastUsedAt: now,
        },
      ]);

    const result = await service.listTokens("user-1");

    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenCalledTimes(2);
    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenNthCalledWith(
      1,
      ["token-1", "token-2"],
      new Date("2025-12-31T00:00:00.000Z"),
      now,
    );
    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenNthCalledWith(
      2,
      ["token-1", "token-2"],
      new Date("2025-12-30T00:00:00.000Z"),
      now,
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "token-1",
        quotaWindows: [
          {
            id: "quota-window-24-amount",
            quotaLimit: 10,
            quotaUnit: "amount",
            quotaWindowHours: 24,
            usedQuota: 5,
            remainingQuota: 5,
            quotaUsagePercent: 50,
            isQuotaExceeded: false,
          },
          {
            id: "quota-window-48-request",
            quotaLimit: 5,
            quotaUnit: "request",
            quotaWindowHours: 48,
            usedQuota: 4,
            remainingQuota: 1,
            quotaUsagePercent: 80,
            isQuotaExceeded: false,
          },
        ],
      }),
      expect.objectContaining({
        id: "token-2",
        quotaWindows: [
          {
            id: "quota-window-24-token",
            quotaLimit: 200,
            quotaUnit: "token",
            quotaWindowHours: 24,
            usedQuota: 0,
            remainingQuota: 200,
            quotaUsagePercent: 0,
            isQuotaExceeded: false,
          },
        ],
      }),
    ]);

    vi.useRealTimers();
  });

  it("rounds amount window usage before comparing against the limit", async () => {
    relayTokenRepository.findByIdWithRelations.mockResolvedValue(
      createToken({
        quotaWindows: [
          {
            id: "quota-window-amount-rounding",
            quotaLimit: 10,
            quotaUnit: "amount",
            quotaWindowHours: 24,
          },
        ],
      }),
    );
    relayUsageRepository.aggregateByRelayTokenIds.mockResolvedValue([
      {
        relayTokenId: "token-1",
        requestCount: 1,
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        chargedAmount: 9.99996,
        coveredAmount: 0,
        lastUsedAt: now,
      },
    ]);

    const result = await service.getToken("token-1", "user-1");

    expect(result.quotaWindows).toEqual([
      {
        id: "quota-window-amount-rounding",
        quotaLimit: 10,
        quotaUnit: "amount",
        quotaWindowHours: 24,
        usedQuota: 10,
        remainingQuota: 0,
        quotaUsagePercent: 100,
        isQuotaExceeded: true,
      },
    ]);
  });

  it("filters requested token ids to user-owned tokens", async () => {
    const ownedToken = createToken({ id: "token-1", name: "Owned Token", quotaLimit: 50 });

    relayTokenRepository.findUsageSummaryTargetsByIds.mockResolvedValue([ownedToken]);

    const result = await service.getUsageSummaries("user-1", ["token-1", "token-unknown"]);

    expect(relayUsageRepository.aggregateByRelayTokenIds).not.toHaveBeenCalled();
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]?.relayTokenId).toBe("token-1");
    expect(result.summaries[0]?.usedQuota).toBe(0);
  });

  it("keeps persisted usedQuota for default summaries even when aggregate data would differ", async () => {
    const token = createToken({
      id: "token-1",
      name: "Persisted Token",
      quotaLimit: 100,
      usedQuota: 33.3333,
      requestCount: 5,
      totalTokens: 500,
      lastUsedAt: now,
    });

    relayTokenRepository.findUsageSummaryTargets.mockResolvedValue([token]);

    const result = await service.getUsageSummaries("user-1");

    expect(relayUsageRepository.aggregateByRelayTokenIds).not.toHaveBeenCalled();
    expect(result.summaries).toEqual([
      expect.objectContaining({
        relayTokenId: "token-1",
        usedQuota: 33.3333,
        chargedAmount: 0,
        coveredAmount: 0,
        requestCount: 5,
        totalTokens: 500,
        lastUsedAt: now,
      }),
    ]);
  });

  it("uses live aggregation for filtered usage summary queries", async () => {
    const startDate = new Date("2026-01-01T00:00:00.000Z");
    const endDate = new Date("2026-01-31T23:59:59.999Z");
    const token = createToken({ id: "token-1", name: "Filtered Token", quotaLimit: 100, usedQuota: 99 });

    relayTokenRepository.findUsageSummaryTargets.mockResolvedValue([token]);
    relayUsageRepository.aggregateByRelayTokenIds.mockResolvedValue([
      {
        relayTokenId: "token-1",
        requestCount: 2,
        requestTokens: 120,
        responseTokens: 180,
        totalTokens: 300,
        cacheCreationTokens: 10,
        cacheReadTokens: 6,
        chargedAmount: 12,
        coveredAmount: 8,
        lastUsedAt: now,
      },
    ]);

    const result = await service.getUsageSummaries("user-1", undefined, startDate, endDate);

    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenCalledWith(["token-1"], startDate, endDate);
    expect(result.summaries[0]).toEqual({
      relayTokenId: "token-1",
      tokenName: "Filtered Token",
      quotaLimit: 100,
      usedQuota: 20,
      remainingQuota: 80,
      quotaUsagePercent: 20,
      isQuotaExceeded: false,
      requestCount: 2,
      requestTokens: 120,
      responseTokens: 180,
      totalTokens: 300,
      cacheCreationTokens: 10,
      cacheReadTokens: 6,
      chargedAmount: 12,
      coveredAmount: 8,
      totalSpend: 20,
      rangeMode: undefined,
      rangeLabel: undefined,
      rangeStartAt: undefined,
      rangeEndAt: undefined,
      lastUsedAt: now,
    });
  });

  it("returns zero usage for empty current-token custom ranges", async () => {
    const startDate = "2099-01-01T00:00:00.000Z";
    const endDate = "2099-01-01T01:00:00.000Z";
    const token = createToken({
      id: "token-1",
      name: "Future Range Token",
      quotaLimit: 100,
      usedQuota: 88,
      requestCount: 99,
      totalTokens: 12345,
      lastUsedAt: now,
    });

    relayUsageRepository.aggregateByRelayTokenIds.mockResolvedValue([]);
    balanceRepository.findAccountByUserId.mockResolvedValue({ balance: 42.12345 });

    const result = await service.getCurrentTokenQuotaSummary(
      token as unknown as Parameters<typeof service.getCurrentTokenQuotaSummary>[0],
      {
        startDate,
        endDate,
      },
    );

    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenNthCalledWith(
      1,
      ["token-1"],
      new Date(startDate),
      new Date(endDate),
    );
    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenNthCalledWith(2, ["token-1"]);
    expect(result).toEqual(
      expect.objectContaining({
        scopedSummary: expect.objectContaining({
          rangeMode: "custom",
          usedQuota: 0,
          requestCount: 0,
          totalTokens: 0,
          chargedAmount: 0,
          coveredAmount: 0,
          totalSpend: 0,
          lastUsedAt: undefined,
        }),
        balance: 42.1234,
        allTimeSummary: expect.objectContaining({
          rangeMode: "lifetime",
          rangeLabel: "lifetime",
          usedQuota: 88,
          requestCount: 99,
          totalTokens: 12345,
          lastUsedAt: now,
        }),
      }),
    );
  });

  it("returns aggregated spend in legacy current quota summary", async () => {
    const token = createToken({
      id: "token-legacy",
      name: "Legacy Token",
      quotaLimit: 100,
      usedQuota: 999,
      requestCount: 999,
      totalTokens: 999,
      lastUsedAt: now,
    });

    relayUsageRepository.aggregateByRelayTokenIds.mockResolvedValue([
      {
        relayTokenId: "token-legacy",
        requestCount: 3,
        requestTokens: 120,
        responseTokens: 180,
        totalTokens: 300,
        cacheCreationTokens: 10,
        cacheReadTokens: 5,
        chargedAmount: 6.25,
        coveredAmount: 1.75,
        lastUsedAt: now,
      },
    ]);
    balanceRepository.findAccountByUserId.mockResolvedValue({ balance: 42.12345 });

    const result = await service.getCurrentTokenQuotaSummaryLegacy(
      token as unknown as Parameters<typeof service.getCurrentTokenQuotaSummaryLegacy>[0],
    );

    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenCalledWith(["token-legacy"]);
    expect(result).toEqual(
      expect.objectContaining({
        balance: 42.1234,
        scopedSummary: expect.objectContaining({
          rangeMode: "lifetime",
          rangeLabel: "lifetime",
          requestCount: 999,
          totalTokens: 300,
          chargedAmount: 6.25,
          coveredAmount: 1.75,
          totalSpend: 8,
          lastUsedAt: now,
        }),
        allTimeSummary: expect.objectContaining({
          chargedAmount: 6.25,
          coveredAmount: 1.75,
          totalSpend: 8,
        }),
      }),
    );
  });

  it("returns detailed usage summary with pagination and quota floor at zero", async () => {
    const token = createToken({ id: "token-1", name: "Quota Token", quotaLimit: 50 });

    relayTokenRepository.findByIdWithRelations.mockResolvedValue(token);
    relayUsageRepository.aggregateByRelayTokenIds.mockResolvedValue([
      {
        relayTokenId: "token-1",
        requestCount: 2,
        requestTokens: 150,
        responseTokens: 250,
        totalTokens: 400,
        cacheCreationTokens: 40,
        cacheReadTokens: 10,
        chargedAmount: 40,
        coveredAmount: 20,
        lastUsedAt: now,
      },
    ]);
    relayUsageRepository.findUsageDetailPageByRelayTokenId.mockResolvedValue({
      total: 2,
      usages: [
        {
          id: "usage-1",
          relayTokenId: "token-1",
          requestTokens: 70,
          responseTokens: 130,
          totalTokens: 200,
          cacheCreationTokens: 20,
          cacheReadTokens: 5,
          path: "/relay/proxy/v1/chat/completions",
          method: "POST",
          statusCode: 200,
          ipAddress: "127.0.0.1",
          createTime: now,
          chargedAmount: 22,
          coveredAmount: 8,
          totalSpend: 30,
        },
        {
          id: "usage-2",
          relayTokenId: "token-1",
          requestTokens: 80,
          responseTokens: 120,
          totalTokens: 200,
          cacheCreationTokens: 20,
          cacheReadTokens: 5,
          path: "/relay/proxy/v1/messages",
          method: "POST",
          statusCode: 200,
          ipAddress: "127.0.0.2",
          createTime: now,
          chargedAmount: 18,
          coveredAmount: 12,
          totalSpend: 30,
        },
      ],
    });

    const result = await service.getUsageSummary("token-1", "user-1", undefined, undefined, 10, 20);

    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenCalledWith(["token-1"], undefined, undefined);
    expect(relayUsageRepository.findUsageDetailPageByRelayTokenId).toHaveBeenCalledWith(
      "token-1",
      undefined,
      undefined,
      10,
      20,
    );
    expect(result).toEqual({
      relayTokenId: "token-1",
      tokenName: "Quota Token",
      quotaLimit: 50,
      usedQuota: 60,
      remainingQuota: 0,
      quotaUsagePercent: 120,
      isQuotaExceeded: true,
      requestCount: 2,
      requestTokens: 150,
      responseTokens: 250,
      totalTokens: 400,
      cacheCreationTokens: 40,
      cacheReadTokens: 10,
      chargedAmount: 40,
      coveredAmount: 20,
      totalSpend: 60,
      rangeMode: undefined,
      rangeLabel: undefined,
      rangeStartAt: undefined,
      rangeEndAt: undefined,
      lastUsedAt: now,
      total: 2,
      limit: 10,
      offset: 20,
      usages: [
        {
          id: "usage-1",
          relayTokenId: "token-1",
          requestTokens: 70,
          responseTokens: 130,
          totalTokens: 200,
          cacheCreationTokens: 20,
          cacheReadTokens: 5,
          path: "/relay/proxy/v1/chat/completions",
          method: "POST",
          statusCode: 200,
          ipAddress: "127.0.0.1",
          createTime: now,
          chargedAmount: 22,
          coveredAmount: 8,
          totalSpend: 30,
        },
        {
          id: "usage-2",
          relayTokenId: "token-1",
          requestTokens: 80,
          responseTokens: 120,
          totalTokens: 200,
          cacheCreationTokens: 20,
          cacheReadTokens: 5,
          path: "/relay/proxy/v1/messages",
          method: "POST",
          statusCode: 200,
          ipAddress: "127.0.0.2",
          createTime: now,
          chargedAmount: 18,
          coveredAmount: 12,
          totalSpend: 30,
        },
      ],
    });
  });

  it("throws NotFoundError when requesting usage detail for a missing token", async () => {
    relayTokenRepository.findByIdWithRelations.mockResolvedValue(null);

    await expect(service.getUsageSummary("missing-token", "user-1")).rejects.toThrow(NotFoundError);
    expect(relayUsageRepository.aggregateByRelayTokenIds).not.toHaveBeenCalled();
    expect(relayUsageRepository.findUsageDetailPageByRelayTokenId).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError when requesting usage detail for another user's token", async () => {
    relayTokenRepository.findByIdWithRelations.mockResolvedValue(createToken({ userId: "other-user" }));

    await expect(service.getUsageSummary("token-1", "user-1")).rejects.toThrow(ForbiddenError);
  });

  it("includes cache token fields in usage stats", async () => {
    relayTokenRepository.findByIdWithRelations.mockResolvedValue(
      createToken({ id: "token-1", userId: "user-1", requestCount: 1 }),
    );
    relayUsageRepository.findByRelayTokenId.mockResolvedValue([
      {
        id: "usage-1",
        relayTokenId: "token-1",
        requestTokens: 30,
        responseTokens: 70,
        totalTokens: 100,
        cacheCreationTokens: 8,
        cacheReadTokens: 2,
        path: "/relay/proxy/v1/chat/completions",
        method: "POST",
        statusCode: 200,
        ipAddress: "127.0.0.1",
        createTime: now,
      },
      {
        id: "usage-2",
        relayTokenId: "token-1",
        requestTokens: 20,
        responseTokens: 30,
        totalTokens: 50,
        cacheCreationTokens: 4,
        cacheReadTokens: 1,
        path: "/relay/proxy/v1/messages",
        method: "POST",
        statusCode: 200,
        ipAddress: "127.0.0.2",
        createTime: now,
      },
    ]);
    relayUsageRepository.aggregateByRelayTokenIds.mockResolvedValue([{ relayTokenId: "token-1", requestCount: 1 }]);

    const result = await service.getUsageStats("token-1", "user-1");

    expect(result.totalTokens).toBe(150);
    expect(result.requestCount).toBe(1);
    expect(result.avgTokensPerRequest).toBe(150);
    expect(result.usages).toEqual([
      expect.objectContaining({ cacheCreationTokens: 8, cacheReadTokens: 2 }),
      expect.objectContaining({ cacheCreationTokens: 4, cacheReadTokens: 1 }),
    ]);
  });

  it("builds current relay token quota summary from persisted token stats", async () => {
    const token = createToken({
      id: "token-1",
      name: "Docs Token",
      quotaLimit: 80,
      usedQuota: 20,
      totalTokens: 100,
      requestCount: 3,
      allowedModels: "gpt-5.4,gpt-5.3-codex",
      expiresAt: now,
      lastUsedAt: now,
      quotaWindows: [
        {
          id: "quota-window-amount",
          quotaLimit: 10,
          quotaUnit: "amount",
          quotaWindowHours: 24,
        },
        {
          id: "quota-window-token",
          quotaLimit: 120,
          quotaUnit: "token",
          quotaWindowHours: 24,
        },
      ],
    });

    balanceRepository.findAccountByUserId.mockResolvedValue({ balance: 66.5 });
    relayUsageRepository.aggregateByRelayTokenIds.mockResolvedValue([
      {
        relayTokenId: "token-1",
        requestCount: 2,
        requestTokens: 30,
        responseTokens: 70,
        totalTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        chargedAmount: 7.5,
        coveredAmount: 0,
        lastUsedAt: now,
      },
    ]);

    const result = await service.getCurrentTokenQuotaSummary(token as any);

    expect(balanceRepository.findAccountByUserId).toHaveBeenCalledWith("user-1");
    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenCalledTimes(2);
    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenNthCalledWith(1, ["token-1"]);
    expect(result).toEqual({
      scopedSummary: {
        relayTokenId: "token-1",
        tokenName: "Docs Token",
        quotaLimit: 80,
        usedQuota: 20,
        remainingQuota: 60,
        quotaUsagePercent: 25,
        isQuotaExceeded: false,
        requestCount: 3,
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        chargedAmount: 0,
        coveredAmount: 0,
        totalSpend: 0,
        rangeMode: "lifetime",
        rangeLabel: "lifetime",
        rangeStartAt: undefined,
        rangeEndAt: undefined,
        lastUsedAt: now,
      },
      balance: 66.5,
      status: MANAGED_STATUS.ENABLED,
      expiresAt: now,
      quotaWindows: [
        {
          id: "quota-window-amount",
          quotaLimit: 10,
          quotaUnit: "amount",
          quotaWindowHours: 24,
          usedQuota: 7.5,
          remainingQuota: 2.5,
          quotaUsagePercent: 75,
          isQuotaExceeded: false,
        },
        {
          id: "quota-window-token",
          quotaLimit: 120,
          quotaUnit: "token",
          quotaWindowHours: 24,
          usedQuota: 100,
          remainingQuota: 20,
          quotaUsagePercent: 83.33333333333334,
          isQuotaExceeded: false,
        },
      ],
      allowedModels: "gpt-5.4,gpt-5.3-codex",
      ipWhitelist: undefined,
      allTimeSummary: {
        relayTokenId: "token-1",
        tokenName: "Docs Token",
        quotaLimit: 80,
        usedQuota: 7.5,
        remainingQuota: 72.5,
        quotaUsagePercent: 9.375,
        isQuotaExceeded: false,
        requestCount: 3,
        requestTokens: 30,
        responseTokens: 70,
        totalTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        chargedAmount: 7.5,
        coveredAmount: 0,
        totalSpend: 7.5,
        rangeMode: "lifetime",
        rangeLabel: "lifetime",
        rangeStartAt: undefined,
        rangeEndAt: undefined,
        lastUsedAt: now,
      },
    });
  });

  it("builds current quota summary daily reset ranges at request time", async () => {
    const requestNow = new Date("2026-06-25T04:55:55.596Z");
    vi.useFakeTimers();
    vi.setSystemTime(requestNow);

    const token = createToken({
      id: "token-1",
      name: "Daily Token",
      quotaLimit: 100,
      usedQuota: 60,
      requestCount: 10,
      totalTokens: 1000,
      lastUsedAt: now,
    });

    balanceRepository.findAccountByUserId.mockResolvedValue({ balance: 42 });
    relayUsageRepository.aggregateByRelayTokenIds
      .mockResolvedValueOnce([
        {
          relayTokenId: "token-1",
          requestCount: 3,
          requestTokens: 100,
          responseTokens: 200,
          totalTokens: 300,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          chargedAmount: 12,
          coveredAmount: 0,
          lastUsedAt: requestNow,
        },
      ])
      .mockResolvedValueOnce([
        {
          relayTokenId: "token-1",
          requestCount: 10,
          requestTokens: 400,
          responseTokens: 600,
          totalTokens: 1000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          chargedAmount: 60,
          coveredAmount: 0,
          lastUsedAt: requestNow,
        },
      ]);

    const result = await service.getCurrentTokenQuotaSummary(token as any, {
      resetAt: "00:00",
      timezoneOffsetMinutes: 0,
    });

    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenNthCalledWith(
      1,
      ["token-1"],
      new Date("2026-06-25T00:00:00.000Z"),
      requestNow,
    );
    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenNthCalledWith(2, ["token-1"]);
    expect(result).toEqual(
      expect.objectContaining({
        scopedSummary: expect.objectContaining({
          rangeMode: "daily-reset",
          rangeStartAt: new Date("2026-06-25T00:00:00.000Z"),
          rangeEndAt: requestNow,
          requestCount: 3,
          totalTokens: 300,
          usedQuota: 12,
        }),
        allTimeSummary: expect.objectContaining({
          rangeMode: "lifetime",
          requestCount: 10,
          totalTokens: 1000,
          usedQuota: 60,
        }),
      }),
    );
  });

  it("returns an empty current quota summary when no balance account or window rules exist", async () => {
    const token = createToken({
      id: "token-3",
      name: "Windowless Token",
      quotaLimit: null,
      usedQuota: 0,
      requestCount: 0,
      totalTokens: 0,
      quotaWindows: [],
      lastUsedAt: null,
    });

    balanceRepository.findAccountByUserId.mockResolvedValue(null);
    relayUsageRepository.aggregateByRelayTokenIds.mockResolvedValue([]);

    const result = await service.getCurrentTokenQuotaSummary(token as any);

    expect(balanceRepository.findAccountByUserId).toHaveBeenCalledWith("user-1");
    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenCalledTimes(1);
    expect(relayUsageRepository.aggregateByRelayTokenIds).toHaveBeenCalledWith(["token-3"]);
    expect(result).toEqual({
      scopedSummary: {
        relayTokenId: "token-3",
        tokenName: "Windowless Token",
        quotaLimit: undefined,
        usedQuota: 0,
        remainingQuota: undefined,
        quotaUsagePercent: undefined,
        isQuotaExceeded: false,
        requestCount: 0,
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        chargedAmount: 0,
        coveredAmount: 0,
        totalSpend: 0,
        rangeMode: "lifetime",
        rangeLabel: "lifetime",
        rangeStartAt: undefined,
        rangeEndAt: undefined,
        lastUsedAt: undefined,
      },
      balance: 0,
      status: MANAGED_STATUS.ENABLED,
      expiresAt: undefined,
      quotaWindows: [],
      allowedModels: undefined,
      ipWhitelist: undefined,
      allTimeSummary: {
        relayTokenId: "token-3",
        tokenName: "Windowless Token",
        quotaLimit: undefined,
        usedQuota: 0,
        remainingQuota: undefined,
        quotaUsagePercent: undefined,
        isQuotaExceeded: false,
        requestCount: 0,
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        chargedAmount: 0,
        coveredAmount: 0,
        totalSpend: 0,
        rangeMode: "lifetime",
        rangeLabel: "lifetime",
        rangeStartAt: undefined,
        rangeEndAt: undefined,
        lastUsedAt: undefined,
      },
    });
  });
});
