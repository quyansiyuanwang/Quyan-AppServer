import { EventEmitter } from "events";
import http from "http";
import { Readable, Writable } from "stream";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RelayProxyService } from "../../../src/services/relay/relay-proxy.service";
import { RELAY_CHANNEL_STATUS } from "../../../src/constant/relay-channel";
import { EnvSpace } from "../../../src/config/env";
import { GatewayTimeoutError, LockBackendUnavailableError, TooManyRequestsError } from "../../../src/util/errors";
import { OperationType } from "../../../src/constant/operation-type";

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return {
    ...actual,
    default: vi.fn(),
  };
});

vi.mock("@/middleware/error-tracker", () => ({
  trackErrorForIp: vi.fn().mockResolvedValue(undefined),
}));

const axiosMock = vi.mocked(axios);

const createChannel = (id: string, name: string, upstreamHost: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  status: RELAY_CHANNEL_STATUS.ENABLED,
  openaiUpstreamUrl: `https://${upstreamHost}`,
  openaiUpstreamApiKey: `${id}-key`,
  anthropicUpstreamUrl: null,
  anthropicUpstreamApiKey: null,
  geminiUpstreamUrl: null,
  geminiUpstreamApiKey: null,
  multiplier: 1,
  allowedFormats: "openai",
  allowedModels: null,
  addUserIdentifier: true,
  inputTokensIncludeCacheRead: false,
  ...overrides,
});

const createRelayToken = () => {
  const primaryChannel = createChannel("channel-primary", "Primary", "primary.example.com");
  const secondaryChannel = createChannel("channel-secondary", "Secondary", "secondary.example.com");

  return {
    id: "token-1",
    userId: "user-1",
    token: "relay-token",
    allowedModels: null,
    channelId: primaryChannel.id,
    channel: primaryChannel,
    failoverConfig: {
      enabled: true,
      maxRetries: 1,
      retryStatusCodes: ["503"],
    },
    channelConfigs: [
      {
        relayTokenId: "token-1",
        channelId: primaryChannel.id,
        priority: 0,
        channel: primaryChannel,
      },
      {
        relayTokenId: "token-1",
        channelId: secondaryChannel.id,
        priority: 1,
        channel: secondaryChannel,
      },
    ],
  } as any;
};

const createRelayTokenWithThreeChannels = () => {
  const primaryChannel = createChannel("channel-primary", "Primary", "primary.example.com", {
    allowedModels: JSON.stringify(["gpt-4o"]),
  });
  const secondaryChannel = createChannel("channel-secondary", "Secondary", "secondary.example.com", {
    allowedModels: JSON.stringify(["gpt-4o"]),
  });
  const tertiaryChannel = createChannel("channel-tertiary", "Tertiary", "tertiary.example.com");

  return {
    id: "token-1",
    userId: "user-1",
    token: "relay-token",
    allowedModels: null,
    channelId: primaryChannel.id,
    channel: primaryChannel,
    failoverConfig: {
      enabled: true,
      maxRetries: 1,
      retryStatusCodes: ["503"],
    },
    channelConfigs: [
      {
        relayTokenId: "token-1",
        channelId: primaryChannel.id,
        priority: 0,
        channel: primaryChannel,
      },
      {
        relayTokenId: "token-1",
        channelId: secondaryChannel.id,
        priority: 1,
        channel: secondaryChannel,
      },
      {
        relayTokenId: "token-1",
        channelId: tertiaryChannel.id,
        priority: 2,
        channel: tertiaryChannel,
      },
    ],
  } as any;
};

const createRelayTokenWithPooledChannel = (overrides: Record<string, unknown> = {}) => {
  const memberA = createChannel("member-a", "Member A", "member-a.example.com", {
    allowedModels: JSON.stringify(["gpt-4o-mini"]),
  });
  const memberB = createChannel("member-b", "Member B", "member-b.example.com", {
    allowedModels: JSON.stringify(["gpt-4o-mini"]),
  });
  const memberC = createChannel("member-c", "Member C", "member-c.example.com", {
    allowedModels: JSON.stringify(["gpt-4o-mini"]),
  });

  const pooledChannel = {
    ...createChannel("pool-1", "Pool", "pool.example.com"),
    channelType: "pooled",
    routingStrategy: "priority",
    routingConfig: {
      maxRetries: 2,
      retryStatusCodes: ["4xx", "5xx"],
      failbackCooldownMinutes: 0,
    },
    openaiUpstreamUrl: null,
    openaiUpstreamApiKey: null,
    poolMembers: [
      {
        id: "pool-member-a",
        memberChannelId: memberA.id,
        priority: 1,
        weight: 5,
        enabled: true,
        memberChannel: memberA,
      },
      {
        id: "pool-member-b",
        memberChannelId: memberB.id,
        priority: 2,
        weight: 1,
        enabled: true,
        memberChannel: memberB,
      },
      {
        id: "pool-member-c",
        memberChannelId: memberC.id,
        priority: 3,
        weight: 2,
        enabled: true,
        memberChannel: memberC,
      },
    ],
  };

  return {
    id: "token-pooled",
    userId: "user-1",
    token: "relay-token-pooled",
    allowedModels: null,
    channelId: pooledChannel.id,
    channel: pooledChannel,
    ...overrides,
  } as any;
};

const createRequest = (overrides: Record<string, unknown> = {}) => ({
  path: "/relay/proxy/v1/chat/completions",
  originalUrl: "/relay/proxy/v1/chat/completions",
  method: "POST",
  body: {
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "hello" }],
  },
  query: {},
  headers: {
    "content-type": "application/json",
  },
  ip: "127.0.0.1",
  connection: { remoteAddress: "127.0.0.1" },
  on: vi.fn(),
  ...overrides,
});

const createService = (
  overrides: {
    redis?: Record<string, any>;
    relayConfig?: Record<string, any>;
  } = {},
) => {
  const relayTokenRepo = {
    updateChannelConfigUsage: vi.fn().mockResolvedValue(null),
    createSwitchLog: vi.fn().mockResolvedValue({ id: "switch-1" }),
  };
  const relayUsageRepo = {
    aggregateByRelayTokenIds: vi.fn().mockResolvedValue([]),
  };
  const relayProxyRepository = {
    recordUsageWithoutCharge: vi.fn().mockResolvedValue(undefined),
    recordUsageWithZeroChargeTransaction: vi.fn().mockResolvedValue(undefined),
  };
  const relayConfigService = {
    getRelayConfig: vi.fn().mockResolvedValue({
      maxConcurrency: 3,
      queueTimeout: 1000,
      enableQueue: true,
      upstreamStreamTimeout: 30000,
      globalMultiplier: 1,
      ...overrides.relayConfig,
    }),
  };
  const modelPricingService = {
    getModelPricing: vi.fn().mockResolvedValue([
      {
        model: "gpt-4o-mini",
        provider: "gpt-4o-mini",
        pricingType: "token-based",
        inputPrice: 1000,
        outputPrice: 2000,
        cacheCreationMultiplier: 1.25,
        cacheReadMultiplier: 0.1,
        supportedFormats: "openai",
      },
    ]),
  };
  const usageChargeService = {
    hasCoverageOrPositiveBalance: vi.fn().mockResolvedValue(true),
    chargeUsage: vi.fn().mockResolvedValue({ applied: true }),
  };
  const businessLogService = {
    logOperation: vi.fn().mockResolvedValue(undefined),
  };
  const relayPoolResolver = {
    resolveActiveLeafCandidates: vi.fn(
      async (roots: any[], orderMembers?: (pool: any, members: any[]) => Promise<any[]>) => {
        const candidates: any[] = [];
        for (const root of roots) {
          if (!root) continue;
          if (!["pooled", "automatic-proxy-pool"].includes(root.channelType)) {
            candidates.push({ resolvedChannel: root, displayChannel: root });
            continue;
          }

          const members = (root.poolMembers ?? [])
            .filter((member: any) => member.enabled !== false && member.memberChannel)
            .map((member: any) => ({
              memberChannelId: member.memberChannelId,
              priority: member.priority,
              weight: member.weight,
              enabled: member.enabled,
            }));
          const orderedMembers = orderMembers ? await orderMembers(root, members) : members;
          for (const member of orderedMembers) {
            const sourceMember = (root.poolMembers ?? []).find(
              (candidate: any) => candidate.memberChannelId === member.memberChannelId,
            );
            if (sourceMember?.memberChannel)
              candidates.push({ resolvedChannel: sourceMember.memberChannel, displayChannel: root });
          }
        }
        return candidates;
      },
    ),
  };
  const redis = {
    isRedisAvailable: vi.fn().mockReturnValue(true),
    acquireSemaphoreSlot: vi.fn().mockResolvedValue("relay:concurrency:default:user-1:slot:1"),
    reserveSemaphoreQueueTicket: vi.fn().mockResolvedValue(1),
    tryAcquireQueuedSemaphoreSlot: vi.fn().mockResolvedValue("relay:concurrency:default:user-1:slot:1"),
    cancelSemaphoreQueueTicket: vi.fn().mockResolvedValue(true),
    deleteIfValueMatches: vi.fn().mockResolvedValue(true),
    extendIfValueMatches: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(null),
    ttl: vi.fn().mockResolvedValue(-2),
    getKeysByPattern: vi.fn().mockResolvedValue([]),
    ...overrides.redis,
  };

  const service = new RelayProxyService(
    relayTokenRepo as any,
    relayUsageRepo as any,
    relayProxyRepository as any,
    relayConfigService as any,
    modelPricingService as any,
    usageChargeService as any,
    redis as any,
    businessLogService as any,
    relayPoolResolver as any,
  );

  return {
    service,
    relayTokenRepo,
    relayUsageRepo,
    relayProxyRepository,
    relayConfigService,
    modelPricingService,
    usageChargeService,
    businessLogService,
    relayPoolResolver,
    redis,
  };
};

describe("RelayProxyService failover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axiosMock.mockReset();
  });

  it("treats /images/variations as OpenAI image traffic", () => {
    const { service } = createService();

    expect((service as any).isOpenAIFormat({ path: "/relay/proxy/v1/images/variations" })).toBe(true);
    expect(
      (service as any).isImageRequest(
        {
          path: "/relay/proxy/v1/images/variations",
          body: { model: "gpt-image-1", image: "abc" },
        },
        "openai",
      ),
    ).toBe(true);
  });

  it("uses a global concurrency key for image scope", () => {
    expect((RelayProxyService as any).getConcurrencyKey("user-1", "default")).toBe("relay:concurrency:default:user-1");
    expect((RelayProxyService as any).getConcurrencyKey("user-1", "image")).toBe("relay:concurrency:image:global");
  });

  it("detects /responses image generation requests as image scope traffic", () => {
    const { service } = createService();

    expect(
      (service as any).isImageRequest(
        {
          path: "/relay/proxy/v1/responses",
          body: {
            tools: [{ type: "image_generation" }],
          },
        },
        "openai",
      ),
    ).toBe(true);

    expect(
      (service as any).isImageRequest(
        {
          path: "/relay/proxy/v1/responses",
          body: {
            tools: [{ type: "web_search" }],
          },
        },
        "openai",
      ),
    ).toBe(false);
  });

  it("detects OpenAI multimodal image payloads as image scope traffic", () => {
    const { service } = createService();

    expect(
      (service as any).isImageRequest(
        createRequest({
          body: {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: "describe this image" },
                  {
                    type: "image_url",
                    image_url: {
                      url: "https://example.com/example.png",
                    },
                  },
                ],
              },
            ],
          },
        }),
        "openai",
      ),
    ).toBe(true);

    expect(
      (service as any).isImageRequest(
        {
          path: "/relay/proxy/v1/responses",
          body: {
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: "describe this image" },
                  {
                    type: "input_image",
                    image_url: "https://example.com/example.png",
                  },
                ],
              },
            ],
          },
        },
        "openai",
      ),
    ).toBe(true);

    expect((service as any).isImageRequest(createRequest(), "openai")).toBe(false);
  });

  it("detects Anthropic image blocks as image scope traffic", () => {
    const { service } = createService();

    expect(
      (service as any).isImageRequest(
        {
          path: "/relay/proxy/v1/messages",
          body: {
            model: "claude-3-5-sonnet",
            max_tokens: 512,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: "describe this image" },
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/png",
                      data: "ZmFrZS1pbWFnZQ==",
                    },
                  },
                ],
              },
            ],
          },
        },
        "anthropic",
      ),
    ).toBe(true);

    expect(
      (service as any).isImageRequest(
        {
          path: "/relay/proxy/v1/messages",
          body: {
            model: "claude-3-5-sonnet",
            max_tokens: 512,
            messages: [{ role: "user", content: "hello" }],
          },
        },
        "anthropic",
      ),
    ).toBe(false);
  });

  it("detects Gemini image parts as image scope traffic", () => {
    const { service } = createService();

    expect(
      (service as any).isImageRequest(
        {
          path: "/relay/proxy/v1/models/gemini-2.0-flash:generateContent",
          body: {
            contents: [
              {
                role: "user",
                parts: [
                  { text: "describe this image" },
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: "ZmFrZS1pbWFnZQ==",
                    },
                  },
                ],
              },
            ],
          },
        },
        "gemini",
      ),
    ).toBe(true);

    expect(
      (service as any).isImageRequest(
        {
          path: "/relay/proxy/v1/models/gemini-2.0-flash:generateContent",
          body: {
            contents: [
              {
                role: "user",
                parts: [
                  {
                    fileData: {
                      mimeType: "image/jpeg",
                      fileUri: "gs://bucket/example.jpg",
                    },
                  },
                ],
              },
            ],
          },
        },
        "gemini",
      ),
    ).toBe(true);

    expect(
      (service as any).isImageRequest(
        {
          path: "/relay/proxy/v1/models/gemini-2.0-flash:generateContent",
          body: {
            contents: [{ role: "user", parts: [{ text: "hello" }] }],
          },
        },
        "gemini",
      ),
    ).toBe(false);
  });

  it("reports scoped redis concurrency status", async () => {
    const defaultSlot1 = "relay:concurrency:default:user-1:slot:1";
    const defaultSlot2 = "relay:concurrency:default:user-1:slot:2";
    const imageSlot1 = "relay:concurrency:image:global:slot:1";
    const ttlByKey: Record<string, number> = {
      [defaultSlot1]: 21,
      [defaultSlot2]: 18,
      [imageSlot1]: 12,
    };

    const { service } = createService({
      redis: {
        isRedisAvailable: vi.fn().mockReturnValue(true),
        getKeysByPattern: vi.fn().mockImplementation((pattern: string) => {
          if (pattern === "relay:concurrency:default:user-1:slot:*")
            return Promise.resolve([defaultSlot1, defaultSlot2]);
          if (pattern === "relay:concurrency:image:global:slot:*") return Promise.resolve([imageSlot1]);
          if (pattern === "relay:concurrency:default:user-1:queue:waiter:*")
            return Promise.resolve(["relay:concurrency:default:user-1:queue:waiter:1"]);
          if (pattern === "relay:concurrency:image:global:queue:waiter:*")
            return Promise.resolve([
              "relay:concurrency:image:global:queue:waiter:1",
              "relay:concurrency:image:global:queue:waiter:2",
            ]);
          return Promise.resolve([]);
        }),
        ttl: vi.fn().mockImplementation((key: string) => Promise.resolve(ttlByKey[key] ?? -2)),
      },
    });

    const result = await service.getConcurrencyStatus("user-1");

    expect(result.redisAvailable).toBe(true);
    expect(result.userId).toBe("user-1");
    expect(result.limits).toEqual({
      maxConcurrency: 3,
      effectiveImageMaxConcurrency: Math.min(3, EnvSpace.relayResourceGuardConfig.imageMaxConcurrency),
      imageMaxConcurrencyCap: EnvSpace.relayResourceGuardConfig.imageMaxConcurrency,
      enableQueue: true,
      queueTimeoutMs: 1000,
      effectiveImageQueueTimeoutMs: Math.min(1000, EnvSpace.relayResourceGuardConfig.imageQueueTimeoutMs),
      imageQueueTimeoutMs: EnvSpace.relayResourceGuardConfig.imageQueueTimeoutMs,
      upstreamStreamTimeoutMs: 30000,
      nonStreamUpstreamTimeoutMs: EnvSpace.relayResourceGuardConfig.nonStreamUpstreamTimeoutMs,
    });
    expect(result.totals).toEqual({
      activeCount: 3,
      defaultScopeActiveCount: 2,
      imageScopeActiveCount: 1,
      queuedCount: 3,
      userCount: 1,
    });
    expect(result.items).toEqual([
      {
        key: "relay:concurrency:image:global",
        userId: "*",
        scope: "image",
        source: "redis",
        activeCount: 1,
        ttlSeconds: 12,
        queueLength: 2,
      },
      {
        key: "relay:concurrency:default:user-1",
        userId: "user-1",
        scope: "default",
        source: "redis",
        activeCount: 2,
        ttlSeconds: 18,
        queueLength: 1,
      },
    ]);
  });

  it("fails closed when redis concurrency backend is unavailable", async () => {
    const relayToken = createRelayToken();
    const req = createRequest();
    const { service } = createService({
      redis: {
        isRedisAvailable: vi.fn().mockReturnValue(false),
      },
    });

    await expect(service.forwardRequest(relayToken, req)).rejects.toBeInstanceOf(LockBackendUnavailableError);
    expect(axiosMock).not.toHaveBeenCalled();
  });

  it("builds pooled attempt plan in priority order and derives pool failover config", async () => {
    const relayToken = createRelayTokenWithPooledChannel();
    const { service } = createService();

    const result = await (service as any).buildAttemptPlan(relayToken);

    expect(result.channels.map((candidate: any) => candidate.resolvedChannel.id)).toEqual([
      "member-a",
      "member-b",
      "member-c",
    ]);
    expect(result.failoverConfig).toEqual({
      enabled: true,
      maxRetries: 2,
      retryStatusCodes: ["4xx", "5xx"],
      failoverThreshold: 1,
      failbackCooldownMinutes: 0,
    });
  });

  it("charges a pooled token by its executing member", async () => {
    const relayToken = createRelayTokenWithPooledChannel();
    relayToken.channel.multiplier = 1.8;
    relayToken.channel.poolMembers[0].memberChannel.multiplier = 3.6;
    const req = createRequest();
    const { service, usageChargeService } = createService();

    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "application/json" },
      data: {
        id: "pooled-billing-response",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    });

    await service.forwardRequest(relayToken, req);

    expect(usageChargeService.hasCoverageOrPositiveBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        modelName: "gpt-4o-mini",
        channelId: "member-a",
      }),
    );
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "member-a",
        executionChannelId: "member-a",
        displayChannelId: "pool-1",
        displayChannelName: "Pool",
        channelMultiplier: 3.6,
        balanceChargeMode: "allow-negative",
      }),
    );
  });

  it("charges an automatic proxy pool token by its executing member", async () => {
    const relayToken = createRelayTokenWithPooledChannel();
    relayToken.channel.channelType = "automatic-proxy-pool";
    relayToken.channel.multiplier = 99;
    relayToken.channel.timePeriodMultipliers = [
      { name: "pool-only", enabled: true, dayOfWeek: "*", startTime: "00:00", endTime: "23:59", multiplier: 9 },
    ];
    relayToken.channel.poolMembers[0].memberChannel.multiplier = 4.2;
    relayToken.routingMode = "automatic-pool";
    relayToken.automaticProxyPoolChannel = relayToken.channel;
    relayToken.channel = null;
    relayToken.channelId = null;
    const req = createRequest();
    const { service, usageChargeService } = createService();

    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "application/json" },
      data: { id: "automatic-pool-response", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    });

    await service.forwardRequest(relayToken, req);

    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "member-a",
        executionChannelId: "member-a",
        displayChannelId: "member-a",
        displayChannelName: "Member A",
        channelMultiplier: 4.2,
      }),
    );
  });

  it("infers the same available models for automatic and directly configured pools", async () => {
    const directToken = createRelayTokenWithPooledChannel();
    const automaticToken = createRelayTokenWithPooledChannel();
    automaticToken.channel.channelType = "automatic-proxy-pool";
    automaticToken.routingMode = "automatic-pool";
    automaticToken.automaticProxyPoolChannel = automaticToken.channel;
    automaticToken.channel = null;
    automaticToken.channelId = null;
    const { service } = createService();

    await expect(service.getAvailableModelsForToken(automaticToken, "openai")).resolves.toEqual(
      await service.getAvailableModelsForToken(directToken, "openai"),
    );
  });

  it("uses round-robin ordering for pooled members", async () => {
    const relayToken = createRelayTokenWithPooledChannel({
      channel: {
        ...createRelayTokenWithPooledChannel().channel,
        routingStrategy: "round-robin",
      },
    });
    const { service } = createService({
      redis: {
        increment: vi.fn().mockResolvedValue(2),
      },
    });

    const result = await (service as any).buildAttemptPlan(relayToken);

    expect(result.channels.map((candidate: any) => candidate.resolvedChannel.id)).toEqual([
      "member-b",
      "member-c",
      "member-a",
    ]);
  });

  it("uses weighted-random ordering for pooled members", async () => {
    const relayToken = createRelayTokenWithPooledChannel({
      channel: {
        ...createRelayTokenWithPooledChannel().channel,
        routingStrategy: "weighted-random",
      },
    });
    const { service } = createService();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0);

    try {
      const result = await (service as any).buildAttemptPlan(relayToken);
      expect(result.channels.map((candidate: any) => candidate.resolvedChannel.id)).toEqual([
        "member-a",
        "member-b",
        "member-c",
      ]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("keeps priority ordering for health-priority and latency-priority pooled strategies", async () => {
    const { service } = createService();

    const healthPlan = await (service as any).buildAttemptPlan(
      createRelayTokenWithPooledChannel({
        channel: {
          ...createRelayTokenWithPooledChannel().channel,
          routingStrategy: "health-priority",
        },
      }),
    );
    const latencyPlan = await (service as any).buildAttemptPlan(
      createRelayTokenWithPooledChannel({
        channel: {
          ...createRelayTokenWithPooledChannel().channel,
          routingStrategy: "latency-priority",
        },
      }),
    );

    expect(healthPlan.channels.map((candidate: any) => candidate.resolvedChannel.id)).toEqual([
      "member-a",
      "member-b",
      "member-c",
    ]);
    expect(latencyPlan.channels.map((candidate: any) => candidate.resolvedChannel.id)).toEqual([
      "member-a",
      "member-b",
      "member-c",
    ]);
  });

  it("retries the next channel on configured upstream status codes", async () => {
    const relayToken = createRelayToken();
    const req = createRequest();
    const { service, relayTokenRepo, usageChargeService, businessLogService } = createService();

    axiosMock
      .mockResolvedValueOnce({
        status: 503,
        headers: { "content-type": "application/json" },
        data: { error: { message: "primary unavailable" } },
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "application/json" },
        data: { id: "resp-1", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      });

    const result = await service.forwardRequest(relayToken, req);

    expect(result.status).toBe(200);
    expect(axiosMock).toHaveBeenCalledTimes(2);
    expect(axiosMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ url: "https://primary.example.com/v1/chat/completions" }),
    );
    expect(axiosMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ url: "https://secondary.example.com/v1/chat/completions" }),
    );
    expect(relayTokenRepo.updateChannelConfigUsage).toHaveBeenNthCalledWith(1, {
      relayTokenId: "token-1",
      channelId: "channel-primary",
      success: false,
    });
    expect(relayTokenRepo.createSwitchLog).toHaveBeenCalledWith(
      expect.objectContaining({
        relayTokenId: "token-1",
        fromChannelId: "channel-primary",
        toChannelId: "channel-secondary",
        triggerStatusCode: 503,
        attemptNumber: 1,
      }),
    );
    expect(relayTokenRepo.updateChannelConfigUsage).toHaveBeenNthCalledWith(2, {
      relayTokenId: "token-1",
      channelId: "channel-secondary",
      success: true,
    });
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({ relayTokenId: "token-1", channelId: "channel-secondary", modelName: "gpt-4o-mini" }),
    );
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operationType: OperationType.RELAY_PROXY_REQUEST_SUCCESS, success: true }),
    );
  });

  it("falls back when the primary channel locally rejects the model", async () => {
    const relayToken = createRelayToken();
    relayToken.channel.allowedModels = JSON.stringify(["gpt-4o"]);
    relayToken.channelConfigs[0].channel.allowedModels = JSON.stringify(["gpt-4o"]);
    const req = createRequest();
    const { service, relayTokenRepo, usageChargeService } = createService();

    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "application/json" },
      data: { id: "resp-local-skip-1", usage: { prompt_tokens: 6, completion_tokens: 3, total_tokens: 9 } },
    });

    const result = await service.forwardRequest(relayToken, req);

    expect(result.status).toBe(200);
    expect(axiosMock).toHaveBeenCalledTimes(1);
    expect(axiosMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ url: "https://secondary.example.com/v1/chat/completions" }),
    );
    expect(relayTokenRepo.createSwitchLog).toHaveBeenCalledWith(
      expect.objectContaining({
        fromChannelId: "channel-primary",
        toChannelId: "channel-secondary",
        triggerError: expect.stringContaining("Channel does not support model gpt-4o-mini"),
      }),
    );
    expect(relayTokenRepo.updateChannelConfigUsage).toHaveBeenCalledWith({
      relayTokenId: "token-1",
      channelId: "channel-secondary",
      success: true,
    });
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "channel-secondary" }),
    );
  });

  it("falls back when the primary channel is missing upstream config", async () => {
    const relayToken = createRelayToken();
    relayToken.channel.openaiUpstreamUrl = null;
    relayToken.channelConfigs[0].channel.openaiUpstreamUrl = null;
    const req = createRequest();
    const { service, relayTokenRepo } = createService();

    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "application/json" },
      data: { id: "resp-local-skip-2", usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
    });

    const result = await service.forwardRequest(relayToken, req);

    expect(result.status).toBe(200);
    expect(axiosMock).toHaveBeenCalledTimes(1);
    expect(axiosMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ url: "https://secondary.example.com/v1/chat/completions" }),
    );
    expect(relayTokenRepo.createSwitchLog).toHaveBeenCalledWith(
      expect.objectContaining({
        fromChannelId: "channel-primary",
        toChannelId: "channel-secondary",
        triggerError: "Channel does not have OpenAI upstream configured",
      }),
    );
  });

  it("does not fall back on locally thrown streaming balance checks before contacting upstream", async () => {
    const relayToken = createRelayToken();
    const req = createRequest({
      body: {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      },
    });
    const res = {
      headersSent: false,
      writableEnded: false,
      finished: false,
      status: vi.fn(() => ({ json: vi.fn() })),
    };
    const { service, relayTokenRepo, usageChargeService } = createService();

    usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValueOnce(false);

    const forwardStreamSpy = vi.spyOn(service as any, "forwardStreamRequest");

    try {
      await expect(service.forwardRequest(relayToken, req, res)).rejects.toThrow("Insufficient balance");

      expect(forwardStreamSpy).not.toHaveBeenCalled();
      expect(relayTokenRepo.createSwitchLog).not.toHaveBeenCalled();
      expect(relayTokenRepo.updateChannelConfigUsage).not.toHaveBeenCalled();
    } finally {
      forwardStreamSpy.mockRestore();
    }
  });

  it("rejects a non-stream request before contacting upstream when no balance or monthly-pass coverage is available", async () => {
    const relayToken = createRelayToken();
    const req = createRequest();
    const { service, usageChargeService } = createService();
    usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValueOnce(false);

    await expect(service.forwardRequest(relayToken, req)).rejects.toThrow("Insufficient balance");

    expect(axiosMock).not.toHaveBeenCalled();
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
  });

  it("rejects an image request before contacting upstream when no balance or monthly-pass coverage is available", async () => {
    const relayToken = createRelayToken();
    const req = createRequest({
      path: "/relay/proxy/v1/images/generations",
      originalUrl: "/relay/proxy/v1/images/generations",
      body: { model: "gpt-4o-mini", prompt: "draw a cat" },
    });
    const { service, usageChargeService } = createService();
    usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValueOnce(false);

    await expect(service.forwardRequest(relayToken, req, {})).rejects.toThrow("Insufficient balance");

    expect(axiosMock).not.toHaveBeenCalled();
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
  });

  it("rejects a lifetime quota that has already been exhausted before contacting upstream", async () => {
    const relayToken = createRelayToken();
    relayToken.quotaLimit = 10;
    relayToken.usedQuota = 10;
    const req = createRequest();
    const { service } = createService();

    await expect(service.forwardRequest(relayToken, req)).rejects.toBeInstanceOf(TooManyRequestsError);

    expect(axiosMock).not.toHaveBeenCalled();
  });

  it("rejects an exhausted rolling token quota before contacting upstream", async () => {
    const relayToken = createRelayToken();
    relayToken.quotaWindows = [{ quotaLimit: 100, quotaUnit: "token", quotaWindowHours: 1 }];
    const req = createRequest();
    const { service, relayUsageRepo } = createService();
    relayUsageRepo.aggregateByRelayTokenIds.mockResolvedValueOnce([
      {
        relayTokenId: relayToken.id,
        requestCount: 1,
        totalTokens: 100,
        chargedAmount: 0,
        coveredAmount: 0,
      },
    ]);

    await expect(service.forwardRequest(relayToken, req)).rejects.toBeInstanceOf(TooManyRequestsError);

    expect(axiosMock).not.toHaveBeenCalled();
  });

  it("rejects exhausted rolling request and amount quotas before contacting upstream", async () => {
    const relayToken = createRelayToken();
    const req = createRequest();
    const { service, relayUsageRepo } = createService();
    relayUsageRepo.aggregateByRelayTokenIds.mockImplementation(async (_ids: string[], startDate: Date) => {
      const isOneHourWindow = Date.now() - startDate.getTime() < 2 * 60 * 60 * 1000;
      return [
        {
          relayTokenId: relayToken.id,
          requestCount: isOneHourWindow ? 2 : 1,
          totalTokens: 1,
          chargedAmount: isOneHourWindow ? 0 : 1,
          coveredAmount: isOneHourWindow ? 0 : 0.5,
        },
      ];
    });

    relayToken.quotaWindows = [{ quotaLimit: 1.5, quotaUnit: "amount", quotaWindowHours: 24 }];
    await expect(service.forwardRequest(relayToken, req)).rejects.toBeInstanceOf(TooManyRequestsError);

    relayToken.quotaWindows = [{ quotaLimit: 2, quotaUnit: "request", quotaWindowHours: 1 }];
    await expect(service.forwardRequest(relayToken, req)).rejects.toBeInstanceOf(TooManyRequestsError);

    expect(axiosMock).not.toHaveBeenCalled();
  });

  it("allows a request after its rolling quota window has no active usage", async () => {
    const relayToken = createRelayToken();
    relayToken.quotaWindows = [{ quotaLimit: 1, quotaUnit: "request", quotaWindowHours: 1 }];
    const req = createRequest();
    const { service, relayUsageRepo } = createService();
    relayUsageRepo.aggregateByRelayTokenIds.mockResolvedValueOnce([]);
    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "application/json" },
      data: { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    });

    await expect(service.forwardRequest(relayToken, req)).resolves.toEqual(expect.objectContaining({ status: 200 }));
    expect(axiosMock).toHaveBeenCalledTimes(1);
  });

  it("settles a request that crosses its lifetime quota boundary so the next request is blocked", async () => {
    const relayToken = createRelayToken();
    relayToken.quotaLimit = 10;
    relayToken.usedQuota = 9.999;
    const req = createRequest();
    const { service, usageChargeService } = createService();
    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "application/json" },
      data: { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    });

    await expect(service.forwardRequest(relayToken, req)).resolves.toEqual(expect.objectContaining({ status: 200 }));
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({ balanceChargeMode: "allow-negative" }),
    );
  });

  it("does not fall back when the relay token globally denies the model", async () => {
    const relayToken = createRelayToken();
    relayToken.allowedModels = "gpt-4o";

    const req = createRequest();
    const { service, relayTokenRepo } = createService();

    await expect(service.forwardRequest(relayToken, req)).rejects.toThrow(
      "Relay token does not allow model gpt-4o-mini",
    );

    expect(axiosMock).not.toHaveBeenCalled();
    expect(relayTokenRepo.createSwitchLog).not.toHaveBeenCalled();
    expect(relayTokenRepo.updateChannelConfigUsage).not.toHaveBeenCalled();
  });

  it("treats local skips as consuming maxRetries and reports exhausted attempts", async () => {
    const relayToken = createRelayTokenWithThreeChannels();
    const req = createRequest();
    const { service, relayTokenRepo } = createService();

    await expect(service.forwardRequest(relayToken, req)).rejects.toThrow(
      "Model gpt-4o-mini could not be routed within maxRetries=1. Attempt summary: #1 Primary: Channel does not support model gpt-4o-mini. Allowed models: gpt-4o; #2 Secondary: Channel does not support model gpt-4o-mini. Allowed models: gpt-4o",
    );

    expect(axiosMock).not.toHaveBeenCalled();
    expect(relayTokenRepo.createSwitchLog).toHaveBeenCalledTimes(1);
    expect(relayTokenRepo.createSwitchLog).toHaveBeenCalledWith(
      expect.objectContaining({
        fromChannelId: "channel-primary",
        toChannelId: "channel-secondary",
        triggerError: expect.stringContaining("Channel does not support model gpt-4o-mini"),
      }),
    );
    expect(relayTokenRepo.updateChannelConfigUsage).toHaveBeenCalledWith({
      relayTokenId: "token-1",
      channelId: "channel-primary",
      success: false,
    });
  });

  it("does not retry when upstream status is not in retryStatusCodes", async () => {
    const relayToken = createRelayToken();
    const req = createRequest();
    const { service, relayTokenRepo, relayProxyRepository, usageChargeService, businessLogService } = createService();

    axiosMock.mockResolvedValueOnce({
      status: 429,
      headers: { "content-type": "application/json" },
      data: { error: { message: "rate limited" } },
    });

    const result = await service.forwardRequest(relayToken, req);

    expect(result.status).toBe(429);
    expect(axiosMock).toHaveBeenCalledTimes(1);
    expect(relayTokenRepo.createSwitchLog).not.toHaveBeenCalled();
    expect(relayTokenRepo.updateChannelConfigUsage).toHaveBeenCalledWith({
      relayTokenId: "token-1",
      channelId: "channel-primary",
      success: false,
    });
    expect(relayProxyRepository.recordUsageWithZeroChargeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        relayTokenId: "token-1",
        modelName: "gpt-4o-mini",
        statusCode: 429,
        isStreaming: false,
      }),
    );
    expect(relayProxyRepository.recordUsageWithoutCharge).not.toHaveBeenCalled();
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
    expect(result.data).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          type: "upstream_error",
          upstream_status: 429,
        }),
      }),
    );
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: OperationType.RELAY_PROXY_REQUEST_FAILED,
        success: false,
        metadata: expect.objectContaining({
          promptPreview: "hello",
          statusCode: 429,
        }),
      }),
    );
  });

  it("retries the next channel when 401 is configured in retryStatusCodes", async () => {
    const relayToken = createRelayToken();
    relayToken.failoverConfig.retryStatusCodes = ["401", "403", "405"];

    const req = createRequest();
    const { service, relayTokenRepo, usageChargeService } = createService();

    axiosMock
      .mockResolvedValueOnce({
        status: 401,
        headers: { "content-type": "application/json" },
        data: { error: { message: "primary unauthorized" } },
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "application/json" },
        data: { id: "resp-2", usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } },
      });

    const result = await service.forwardRequest(relayToken, req);

    expect(result.status).toBe(200);
    expect(axiosMock).toHaveBeenCalledTimes(2);
    expect(relayTokenRepo.createSwitchLog).toHaveBeenCalledWith(
      expect.objectContaining({
        relayTokenId: "token-1",
        fromChannelId: "channel-primary",
        toChannelId: "channel-secondary",
        triggerStatusCode: 401,
        attemptNumber: 1,
      }),
    );
    expect(relayTokenRepo.updateChannelConfigUsage).toHaveBeenNthCalledWith(1, {
      relayTokenId: "token-1",
      channelId: "channel-primary",
      success: false,
    });
    expect(relayTokenRepo.updateChannelConfigUsage).toHaveBeenNthCalledWith(2, {
      relayTokenId: "token-1",
      channelId: "channel-secondary",
      success: true,
    });
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        relayTokenId: "token-1",
        channelId: "channel-secondary",
        modelName: "gpt-4o-mini",
      }),
    );
  });

  it("retries the next channel when wildcard 4xx is configured", async () => {
    const relayToken = createRelayToken();
    relayToken.failoverConfig.retryStatusCodes = ["4xx"];
    const req = createRequest();
    const { service, relayTokenRepo } = createService();

    axiosMock
      .mockResolvedValueOnce({
        status: 429,
        headers: { "content-type": "application/json" },
        data: { error: { message: "primary rate limited" } },
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "application/json" },
        data: { id: "resp-3", usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } },
      });

    const result = await service.forwardRequest(relayToken, req);

    expect(result.status).toBe(200);
    expect(axiosMock).toHaveBeenCalledTimes(2);
    expect(relayTokenRepo.createSwitchLog).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerStatusCode: 429,
        fromChannelId: "channel-primary",
        toChannelId: "channel-secondary",
      }),
    );
  });

  it("retries the next channel when a regex retry rule matches", async () => {
    const relayToken = createRelayToken();
    relayToken.failoverConfig.retryStatusCodes = ["/^5(02|03)$/"];
    const req = createRequest();
    const { service, relayTokenRepo } = createService();

    axiosMock
      .mockResolvedValueOnce({
        status: 503,
        headers: { "content-type": "application/json" },
        data: { error: { message: "primary unavailable" } },
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "application/json" },
        data: { id: "resp-4", usage: { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 } },
      });

    const result = await service.forwardRequest(relayToken, req);

    expect(result.status).toBe(200);
    expect(axiosMock).toHaveBeenCalledTimes(2);
    expect(relayTokenRepo.createSwitchLog).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerStatusCode: 503,
        fromChannelId: "channel-primary",
        toChannelId: "channel-secondary",
      }),
    );
  });

  it("truncates long user prompt previews in relay business logs", async () => {
    const relayToken = createRelayToken();
    const req = createRequest({
      body: {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "x".repeat(800) }],
      },
    });
    const { service, businessLogService } = createService();

    axiosMock.mockResolvedValueOnce({
      status: 429,
      headers: { "content-type": "application/json" },
      data: { error: { message: "rate limited" } },
    });

    await service.forwardRequest(relayToken, req);

    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          promptPreview: expect.stringMatching(/^x{500}…$/),
        }),
      }),
    );
  });

  it("allows streaming retry only before any response is sent to the client", async () => {
    const relayToken = createRelayToken();
    const { service } = createService();
    const req = new EventEmitter() as any;
    req.method = "POST";
    req.path = "/relay/proxy/v1/chat/completions";
    req.ip = "127.0.0.1";
    req.connection = { remoteAddress: "127.0.0.1" };

    const res = {
      headersSent: false,
      writableEnded: false,
      finished: false,
      writeHead: vi.fn(() => {
        res.headersSent = true;
      }),
      write: vi.fn(),
      end: vi.fn(() => {
        res.finished = true;
        res.writableEnded = true;
      }),
      status: vi.fn(() => ({ json: vi.fn() })),
    };

    const requestSpy = vi.spyOn(http, "request").mockImplementation((options: any, callback: any) => {
      const proxyReq = new EventEmitter() as any;
      proxyReq.write = vi.fn();
      proxyReq.end = vi.fn(() => {
        const proxyRes = new EventEmitter() as any;
        proxyRes.statusCode = 503;
        proxyRes.headers = { "content-type": "application/json" };

        callback(proxyRes);
        proxyRes.emit("data", Buffer.from(JSON.stringify({ error: { message: "temporary unavailable" } })));
        proxyRes.emit("end");
      });
      proxyReq.destroy = vi.fn((err?: Error) => {
        if (err) proxyReq.emit("error", err);
      });
      return proxyReq;
    });

    try {
      const result = await (service as any).forwardStreamRequest(
        relayToken,
        req,
        res,
        "http://primary.example.com/v1/chat/completions",
        { Authorization: "Bearer test-key" },
        {
          pricingType: "token-based",
          input: 0.000001,
          output: 0.000002,
          multiplier: 1,
          cacheCreationMultiplier: 1.25,
          cacheReadMultiplier: 0.1,
        },
        "gpt-4o-mini",
        "gpt-4o-mini",
        1,
        1,
        { model: "gpt-4o-mini", stream: true, messages: [] },
        "openai",
        1,
        1,
        "channel-primary",
        "channel-primary",
        "Primary",
        "channel-primary",
        new Date("2026-01-01T00:00:00.000Z"),
        30000,
        true,
        ["503"],
      );

      expect(result).toEqual(
        expect.objectContaining({
          handled: false,
          retryable: true,
          statusCode: 503,
        }),
      );
      expect(res.writeHead).not.toHaveBeenCalled();
      expect(res.write).not.toHaveBeenCalled();
      expect(res.end).not.toHaveBeenCalled();
    } finally {
      requestSpy.mockRestore();
    }
  });

  it("retries an auto-injected OpenAI stream usage option once after a 400 response", async () => {
    const relayToken = createRelayToken();
    const { service, usageChargeService, relayProxyRepository } = createService();
    const req = new EventEmitter() as any;
    req.method = "POST";
    req.path = "/relay/proxy/v1/chat/completions";
    req.ip = "127.0.0.1";
    req.connection = { remoteAddress: "127.0.0.1" };

    const res = {
      headersSent: false,
      writableEnded: false,
      finished: false,
      writeHead: vi.fn(() => {
        res.headersSent = true;
      }),
      write: vi.fn(),
      end: vi.fn(() => {
        res.finished = true;
        res.writableEnded = true;
      }),
    };

    const forwardedBodies: any[] = [];
    let attempt = 0;
    const requestSpy = vi.spyOn(http, "request").mockImplementation((_options: any, callback: any) => {
      const proxyReq = new EventEmitter() as any;
      proxyReq.write = vi.fn((body: Buffer) => forwardedBodies.push(JSON.parse(body.toString("utf8"))));
      proxyReq.end = vi.fn(() => {
        const proxyRes = new EventEmitter() as any;
        proxyRes.headers = { "content-type": attempt === 0 ? "application/json" : "text/event-stream" };
        proxyRes.statusCode = attempt === 0 ? 400 : 200;
        attempt += 1;
        callback(proxyRes);
        if (proxyRes.statusCode === 400) {
          proxyRes.emit("data", Buffer.from(JSON.stringify({ error: { message: "stream_options unsupported" } })));
          proxyRes.emit("end");
          return;
        }
        proxyRes.emit(
          "data",
          Buffer.from('data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n'),
        );
        proxyRes.emit("data", Buffer.from("data: [DONE]\n\n"));
        proxyRes.emit("end");
      });
      proxyReq.destroy = vi.fn((err?: Error) => {
        if (err) proxyReq.emit("error", err);
      });
      return proxyReq;
    });

    try {
      const result = await (service as any).forwardStreamRequest(
        relayToken,
        req,
        res,
        "http://primary.example.com/v1/chat/completions",
        { Authorization: "Bearer test-key" },
        {
          pricingType: "token-based",
          input: 0.000001,
          output: 0.000002,
          multiplier: 1,
          cacheCreationMultiplier: 1.25,
          cacheReadMultiplier: 0.1,
        },
        "gpt-4o-mini",
        "gpt-4o-mini",
        1,
        1,
        { model: "gpt-4o-mini", stream: true, stream_options: { include_usage: true } },
        "openai",
        1,
        1,
        "channel-primary",
        "channel-primary",
        "Primary",
        "channel-primary",
        new Date("2026-01-01T00:00:00.000Z"),
        30000,
        false,
        [],
        true,
        undefined,
        true,
      );

      expect(result).toEqual(expect.objectContaining({ handled: true, success: true, statusCode: 200 }));
      expect(forwardedBodies).toEqual([
        { model: "gpt-4o-mini", stream: true, stream_options: { include_usage: true } },
        { model: "gpt-4o-mini", stream: true },
      ]);
      expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
        expect.objectContaining({ requestTokens: 10, responseTokens: 5, totalTokens: 15 }),
      );
      expect(relayProxyRepository.recordUsageWithZeroChargeTransaction).not.toHaveBeenCalled();
    } finally {
      requestSpy.mockRestore();
    }
  });

  it("does not charge when upstream streaming response is an error", async () => {
    const relayToken = createRelayToken();
    const req = createRequest({
      body: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hello" }], stream: true },
    });
    const res = { headersSent: false, writableEnded: false, finished: false, status: vi.fn(() => ({ json: vi.fn() })) };
    const { service, relayTokenRepo } = createService();
    const forwardStreamSpy = vi
      .spyOn(service as any, "forwardStreamRequest")
      .mockRejectedValueOnce(new GatewayTimeoutError("primary timeout"))
      .mockResolvedValueOnce({ handled: true, success: true, retryable: false, statusCode: 200 });

    try {
      const result = await service.forwardRequest(relayToken, req, res);

      expect(result.status).toBe(200);
      expect(forwardStreamSpy).toHaveBeenCalledTimes(2);
      expect(relayTokenRepo.createSwitchLog).toHaveBeenCalledWith(
        expect.objectContaining({
          fromChannelId: "channel-primary",
          toChannelId: "channel-secondary",
          triggerError: "primary timeout",
          attemptNumber: 1,
        }),
      );
      expect(relayTokenRepo.updateChannelConfigUsage).toHaveBeenNthCalledWith(1, {
        relayTokenId: "token-1",
        channelId: "channel-primary",
        success: false,
      });
      expect(relayTokenRepo.updateChannelConfigUsage).toHaveBeenNthCalledWith(2, {
        relayTokenId: "token-1",
        channelId: "channel-secondary",
        success: true,
      });
    } finally {
      forwardStreamSpy.mockRestore();
    }
  });

  it("does not switch channels after a streaming response has already started", async () => {
    const relayToken = createRelayToken();
    const req = createRequest({
      body: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hello" }], stream: true },
    });
    const resStatusJson = vi.fn();
    const res = {
      headersSent: true,
      writableEnded: false,
      finished: false,
      status: vi.fn(() => ({ json: resStatusJson })),
    };
    const { service, relayTokenRepo } = createService();
    const forwardStreamSpy = vi
      .spyOn(service as any, "forwardStreamRequest")
      .mockRejectedValueOnce(new GatewayTimeoutError("stream interrupted after first chunk"));

    try {
      const result = await service.forwardRequest(relayToken, req, res);

      expect(result.status).toBe(504);
      expect(forwardStreamSpy).toHaveBeenCalledTimes(1);
      expect(relayTokenRepo.createSwitchLog).not.toHaveBeenCalled();
      expect(relayTokenRepo.updateChannelConfigUsage).toHaveBeenCalledWith({
        relayTokenId: "token-1",
        channelId: "channel-primary",
        success: false,
      });
      expect(res.status).not.toHaveBeenCalled();
    } finally {
      forwardStreamSpy.mockRestore();
    }
  });

  it("does not charge when upstream streaming response is an error", async () => {
    const relayToken = createRelayToken();
    const req = new EventEmitter() as any;
    req.method = "POST";
    req.path = "/relay/proxy/v1/chat/completions";
    req.ip = "127.0.0.1";
    req.connection = { remoteAddress: "127.0.0.1" };

    const res = {
      headersSent: false,
      writableEnded: false,
      finished: false,
      writeHead: vi.fn(() => {
        res.headersSent = true;
      }),
      write: vi.fn(),
      end: vi.fn(() => {
        res.finished = true;
        res.writableEnded = true;
      }),
      status: vi.fn(() => ({ json: vi.fn() })),
    };

    const { service, relayProxyRepository, usageChargeService } = createService();

    const requestSpy = vi.spyOn(http, "request").mockImplementation((options: any, callback: any) => {
      const proxyReq = new EventEmitter() as any;
      proxyReq.write = vi.fn();
      proxyReq.end = vi.fn(() => {
        const proxyRes = new EventEmitter() as any;
        proxyRes.statusCode = 503;
        proxyRes.headers = { "content-type": "application/json" };

        callback(proxyRes);
        proxyRes.emit("data", Buffer.from(JSON.stringify({ error: { message: "temporary unavailable" } })));
        proxyRes.emit("end");
      });
      proxyReq.destroy = vi.fn((err?: Error) => {
        if (err) proxyReq.emit("error", err);
      });
      return proxyReq;
    });

    try {
      const result = await (service as any).forwardStreamRequest(
        relayToken,
        req,
        res,
        "http://primary.example.com/v1/chat/completions",
        { Authorization: "Bearer test-key" },
        {
          pricingType: "token-based",
          input: 0.000001,
          output: 0.000002,
          multiplier: 1,
          cacheCreationMultiplier: 1.25,
          cacheReadMultiplier: 0.1,
        },
        "gpt-4o-mini",
        "gpt-4o-mini",
        1,
        { model: "gpt-4o-mini", stream: true, messages: [] },
        "openai",
        1,
        1,
        "channel-primary",
        "channel-primary",
        "Primary",
        "channel-primary",
        new Date("2026-01-01T00:00:00.000Z"),
        30000,
        false,
        ["503"],
      );

      expect(result).toEqual(
        expect.objectContaining({
          handled: true,
          success: false,
          statusCode: 503,
        }),
      );
      expect(relayProxyRepository.recordUsageWithZeroChargeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          relayTokenId: "token-1",
          modelName: "gpt-4o-mini",
          statusCode: 503,
          isStreaming: true,
        }),
      );
      expect(relayProxyRepository.recordUsageWithoutCharge).not.toHaveBeenCalled();
      expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
    } finally {
      requestSpy.mockRestore();
    }
  });

  it("still charges when the client disconnects after upstream streaming has started", async () => {
    const relayToken = createRelayToken();
    const req = new EventEmitter() as any;
    req.method = "POST";
    req.path = "/relay/proxy/v1/chat/completions";
    req.ip = "127.0.0.1";
    req.connection = { remoteAddress: "127.0.0.1" };

    const res = {
      headersSent: false,
      writableEnded: false,
      finished: false,
      writeHead: vi.fn(() => {
        res.headersSent = true;
      }),
      write: vi.fn(),
      end: vi.fn(() => {
        res.finished = true;
        res.writableEnded = true;
      }),
      status: vi.fn(() => ({ json: vi.fn() })),
    };

    const { service, relayProxyRepository, usageChargeService } = createService();

    const requestSpy = vi.spyOn(http, "request").mockImplementation((options: any, callback: any) => {
      const proxyReq = new EventEmitter() as any;
      proxyReq.write = vi.fn();
      proxyReq.end = vi.fn(() => {
        const proxyRes = new EventEmitter() as any;
        proxyRes.statusCode = 200;
        proxyRes.headers = { "content-type": "text/event-stream" };

        callback(proxyRes);
        proxyRes.emit(
          "data",
          Buffer.from(
            'data: {"choices":[{"delta":{"content":"hello"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
          ),
        );
        req.emit("close");
        proxyRes.emit("data", Buffer.from("data: [DONE]\n\n"));
        proxyRes.emit("end");
      });
      proxyReq.destroy = vi.fn((err?: Error) => {
        if (err) proxyReq.emit("error", err);
      });
      return proxyReq;
    });

    try {
      const result = await (service as any).forwardStreamRequest(
        relayToken,
        req,
        res,
        "http://primary.example.com/v1/chat/completions",
        { Authorization: "Bearer test-key" },
        {
          pricingType: "token-based",
          input: 0.000001,
          output: 0.000002,
          multiplier: 1,
          cacheCreationMultiplier: 1.25,
          cacheReadMultiplier: 0.1,
        },
        "gpt-4o-mini",
        "gpt-4o-mini",
        1,
        { model: "gpt-4o-mini", stream: true, messages: [] },
        "openai",
        1,
        1,
        "channel-primary",
        "channel-primary",
        "Primary",
        "channel-primary",
        new Date("2026-01-01T00:00:00.000Z"),
        30000,
        false,
        ["503"],
      );

      expect(result).toEqual(
        expect.objectContaining({
          handled: true,
          success: true,
          statusCode: 200,
        }),
      );
      expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          relayTokenId: "token-1",
          isStreaming: true,
          statusCode: 200,
          totalTokens: 15,
        }),
      );
      expect(relayProxyRepository.recordUsageWithZeroChargeTransaction).not.toHaveBeenCalled();
      expect(relayProxyRepository.recordUsageWithoutCharge).not.toHaveBeenCalled();
    } finally {
      requestSpy.mockRestore();
    }
  });

  it("records zero-cost streaming usage with the allow-negative settlement policy", async () => {
    const relayToken = createRelayToken();
    const { service, usageChargeService } = createService();

    await expect(
      (service as any).finalizeStreamUsage(relayToken, {
        requestTokens: 10,
        responseTokens: 0,
        totalTokens: 10,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0,
        inputRate: 0,
        outputRate: 0,
        multiplier: 1,
        cacheCreationMult: 1.25,
        cacheReadMult: 0.1,
        executionChannelId: "channel-primary",
        displayChannelId: "channel-primary",
        displayChannelName: "Primary",
        channelId: "channel-primary",
        monthlyPassCoverageAt: new Date("2026-01-01T00:00:00.000Z"),
        path: "/v1/chat/completions",
        method: "POST",
        statusCode: 200,
        ipAddress: "127.0.0.1",
        modelName: "gpt-4o-mini",
        modelId: "gpt-4o-mini",
        totalOutputTime: 20,
        timeToFirstByte: 5,
      }),
    ).resolves.toBeUndefined();

    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        cost: 0,
        isStreaming: true,
        balanceChargeMode: "allow-negative",
      }),
    );
  });

  it("streams image responses directly instead of buffering Axios response data", async () => {
    const relayToken = createRelayToken();
    const req = createRequest({
      path: "/relay/proxy/v1/images/generations",
      originalUrl: "/relay/proxy/v1/images/generations",
      body: {
        model: "gpt-4o-mini",
        prompt: "draw a cat",
      },
      once: vi.fn(),
      off: vi.fn(),
    });
    const responseChunks: Buffer[] = [];
    const res = new Writable({
      write(chunk, _encoding, callback) {
        responseChunks.push(Buffer.from(chunk));
        callback();
      },
    }) as any;
    res.headersSent = false;
    res.writeHead = vi.fn((statusCode: number, headers: Record<string, unknown>) => {
      res.headersSent = true;
      res.statusCode = statusCode;
      res.headers = headers;
      return res;
    });

    const { service, usageChargeService } = createService();
    const upstreamBody = Buffer.from(JSON.stringify({ data: [{ b64_json: "abc123" }] }));

    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String(upstreamBody.length),
        connection: "keep-alive",
      },
      data: Readable.from([upstreamBody]),
    });

    const result = await service.forwardRequest(relayToken, req, res);

    expect(result.status).toBe(200);
    expect(result.data).toEqual({});
    expect(Buffer.concat(responseChunks).toString()).toBe(upstreamBody.toString());
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "content-type": "application/json",
      }),
    );
    expect(res.headers["content-length"]).toBeUndefined();
    expect(res.headers.connection).toBeUndefined();
    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: "stream",
        maxContentLength: Infinity,
        data: expect.any(Buffer),
      }),
    );
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        relayTokenId: "token-1",
        channelId: "channel-primary",
        isStreaming: false,
        responseTokens: Math.ceil(upstreamBody.length / 4),
        balanceChargeMode: "allow-negative",
      }),
    );
  });

  it("passes timeMultiplier from channel timePeriodMultipliers to chargeUsage", async () => {
    const relayToken = createRelayToken();
    // Set a time rule that always matches (every day, full day)
    relayToken.channel.timePeriodMultipliers = [
      {
        name: "always-on",
        enabled: true,
        dayOfWeek: "",
        startTime: "00:00",
        endTime: "23:59",
        multiplier: 2.5,
      },
    ];
    // Set channel multiplier to a distinct value for verification
    relayToken.channel.multiplier = 1.5;

    const req = createRequest();
    const { service, usageChargeService } = createService();

    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "application/json" },
      data: {
        id: "time-multiplier-test",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    });

    const result = await service.forwardRequest(relayToken, req);

    expect(result.status).toBe(200);
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelMultiplier: 1.5,
        timeMultiplier: 2.5,
        globalMultiplier: 1, // relayConfig.globalMultiplier = 1
      }),
    );
  });

  it("uses streamed response byte length for image token estimation", () => {
    const { service } = createService();

    const result = service.calculateTokens(
      { model: "gpt-4o-mini", prompt: "draw a cat" },
      { __relayForwardedResponseByteLength: 33 },
      true,
    );

    expect(result.responseTokens).toBe(9);
    expect(result.totalTokens).toBe(result.requestTokens + 9);
  });

  it("injects OpenAI Chat stream usage without changing explicit caller options", () => {
    const { service } = createService();

    const injected = (service as any).addOpenAIStreamUsageOption(
      { model: "gpt-4o-mini", stream: true, stream_options: { include_logprobs: true } },
      "openai",
      "/relay/proxy/v1/chat/completions",
    );
    expect(injected).toEqual({
      autoInjected: true,
      body: {
        model: "gpt-4o-mini",
        stream: true,
        stream_options: { include_logprobs: true, include_usage: true },
      },
    });

    const explicit = (service as any).addOpenAIStreamUsageOption(
      { model: "gpt-4o-mini", stream: true, stream_options: { include_usage: false } },
      "openai",
      "/relay/proxy/v1/chat/completions",
    );
    expect(explicit.autoInjected).toBe(false);
    expect(explicit.body.stream_options).toEqual({ include_usage: false });

    const responses = (service as any).addOpenAIStreamUsageOption(
      { model: "gpt-4o-mini", stream: true },
      "openai",
      "/relay/proxy/v1/responses",
    );
    expect(responses).toEqual({ autoInjected: false, body: { model: "gpt-4o-mini", stream: true } });
  });

  it("does not estimate uncached input when upstream explicitly reports zero input tokens", () => {
    const { service } = createService();

    const result = service.calculateTokens(
      { model: "kimi-k3", messages: [{ role: "user", content: "Reply exactly: ok" }] },
      {
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 90,
          output_tokens: 16,
        },
      },
      true,
    );

    expect(result).toEqual({
      requestTokens: 0,
      responseTokens: 16,
      totalTokens: 16,
      cacheCreationTokens: 0,
      cacheReadTokens: 90,
    });
  });

  describe("calculateCost with pre-processed requestTokens", () => {
    it("calculates cost correctly when requestTokens already has cache read subtracted", () => {
      const { service } = createService();

      // requestTokens is already processed (1000 - 200 = 800)
      const result = (service as any).calculateCost(
        800, // requestTokens (already processed, cache read subtracted)
        500, // responseTokens
        1500, // totalTokens
        { input: 0.01, output: 0.02 }, // rateConfig (per 1M tokens)
        1.0, // globalMultiplier
        100, // cacheCreationTokens
        200, // cacheReadTokens
        1.25, // cacheCreationMultiplier
        0.1, // cacheReadMultiplier
      );

      // Input cost = 800 * 0.01 + 100 * 0.01 * 1.25 + 200 * 0.01 * 0.1
      //            = 8 + 1.25 + 0.2 = 9.45
      // Output cost = 500 * 0.02 = 10
      // Total = 19.45
      expect(result.cost).toBe(19.45);
      expect(result.inputRate).toBe(0.01);
      expect(result.outputRate).toBe(0.02);
    });

    it("calculates cost correctly when requestTokens does not need cache read subtraction", () => {
      const { service } = createService();

      // requestTokens is already the billing-ready value (no subtraction needed)
      const result = (service as any).calculateCost(
        1000, // requestTokens (already processed, no subtraction needed)
        500, // responseTokens
        1500, // totalTokens
        { input: 0.01, output: 0.02 }, // rateConfig
        1.0, // globalMultiplier
        100, // cacheCreationTokens
        200, // cacheReadTokens
        1.25, // cacheCreationMultiplier
        0.1, // cacheReadMultiplier
      );

      // Input cost = 1000 * 0.01 + 100 * 0.01 * 1.25 + 200 * 0.01 * 0.1
      //            = 10 + 1.25 + 0.2 = 11.45
      // Output cost = 500 * 0.02 = 10
      // Total = 21.45
      expect(result.cost).toBe(21.45);
    });

    it("handles case where requestTokens is zero after processing", () => {
      const { service } = createService();

      // requestTokens was processed to 0 (max(0, 100 - 200) = 0)
      const result = (service as any).calculateCost(
        0, // requestTokens (already processed to 0)
        500, // responseTokens
        600, // totalTokens
        { input: 0.01, output: 0.02 }, // rateConfig
        1.0, // globalMultiplier
        0, // cacheCreationTokens
        200, // cacheReadTokens
        1.25, // cacheCreationMultiplier
        0.1, // cacheReadMultiplier
      );

      // Input cost = 0 * 0.01 + 0 + 200 * 0.01 * 0.1 = 0.2
      // Output cost = 500 * 0.02 = 10
      // Total = 10.2
      expect(result.cost).toBe(10.2);
    });

    it("defaults inputTokensIncludeCacheRead to false when not provided", () => {
      const { service } = createService();

      const result = (service as any).calculateCost(
        1000, // requestTokens
        500, // responseTokens
        1500, // totalTokens
        { input: 0.01, output: 0.02 }, // rateConfig
        1.0, // globalMultiplier
        0, // cacheCreationTokens
        200, // cacheReadTokens
        1.25, // cacheCreationMultiplier
        0.1, // cacheReadMultiplier
        // inputTokensIncludeCacheRead not provided, should default to false
      );

      // Should behave as if inputTokensIncludeCacheRead = false
      // Base request tokens = 1000 (no subtraction)
      // Input cost = 1000 * 0.01 + 200 * 0.01 * 0.1 = 10 + 0.2 = 10.2
      // Output cost = 500 * 0.02 = 10
      // Total = 20.2
      expect(result.cost).toBe(20.2);
    });

    it("works correctly with per-request pricing (ignores inputTokensIncludeCacheRead)", () => {
      const { service } = createService();

      const result = (service as any).calculateCost(
        1000, // requestTokens
        500, // responseTokens
        1500, // totalTokens
        { pricingType: "per-request", fixedPrice: 0.05 }, // per-request pricing
        2.0, // globalMultiplier
        100, // cacheCreationTokens
        200, // cacheReadTokens
        1.25, // cacheCreationMultiplier
        0.1, // cacheReadMultiplier
        true, // inputTokensIncludeCacheRead (should be ignored)
      );

      // Per-request pricing: fixedPrice * globalMultiplier = 0.05 * 2.0 = 0.1
      expect(result.cost).toBe(0.1);
      expect(result.inputRate).toBe(0);
      expect(result.outputRate).toBe(0);
    });

    it("applies globalMultiplier 2.0 to token-based cost (cost doubles)", () => {
      const { service } = createService();

      const result = (service as any).calculateCost(
        1000,
        500,
        1500,
        { input: 0.01, output: 0.02 },
        2.0, // globalMultiplier
        0,
        0,
        1,
        1,
      );

      // Input cost = 1000 * 0.01 = 10
      // Output cost = 500 * 0.02 = 10
      // Total = (10+10) * 2.0 = 40
      expect(result.cost).toBe(40);
    });

    it("applies globalMultiplier 0.5 to token-based cost (cost halves / discount)", () => {
      const { service } = createService();

      const result = (service as any).calculateCost(
        1000,
        500,
        1500,
        { input: 0.01, output: 0.02 },
        0.5, // globalMultiplier (discount)
        0,
        0,
        1,
        1,
      );

      // Input cost = 1000 * 0.01 = 10
      // Output cost = 500 * 0.02 = 10
      // Total = (10+10) * 0.5 = 10
      expect(result.cost).toBe(10);
    });

    it("applies globalMultiplier 0 (cost becomes 0)", () => {
      const { service } = createService();

      const result = (service as any).calculateCost(
        1000,
        500,
        1500,
        { input: 0.01, output: 0.02 },
        0, // globalMultiplier (zero)
        0,
        0,
        1,
        1,
      );

      // (10+10) * 0 = 0
      expect(result.cost).toBe(0);
    });

    it("applies globalMultiplier with pre-request pricing", () => {
      const { service } = createService();

      const result = (service as any).calculateCost(
        0,
        0,
        0,
        { pricingType: "per-request", fixedPrice: 0.1 },
        3.0, // globalMultiplier
        0,
        0,
        1,
        1,
      );

      // 0.1 * 3.0 = 0.30000000000000004 (IEEE 754)
      // Math.ceil(0.30000000000000004 * 10000) / 10000 = 0.3001
      expect(result.cost).toBe(0.3001);
    });

    it("returns multiplier field equal to globalMultiplier", () => {
      const { service } = createService();

      const result = (service as any).calculateCost(1000, 500, 1500, { input: 0.01, output: 0.02 }, 2.5, 0, 0, 1, 1);

      expect(result.multiplier).toBe(2.5);
    });
  });
});
