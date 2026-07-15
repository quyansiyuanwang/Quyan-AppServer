import { EventEmitter } from "events";
import { Readable, Writable } from "stream";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RelayProxyService } from "../../../src/services/relay/relay-proxy.service";
import { RELAY_CHANNEL_STATUS } from "../../../src/constant/relay-channel";
import { PayloadTooLargeError } from "../../../src/util/errors";

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

const createChannel = (id: string, name: string, upstreamHost: string) => ({
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
});

const createRelayToken = () => {
  const primaryChannel = createChannel("channel-primary", "Primary", "primary.example.com");

  return {
    id: "token-1",
    userId: "user-1",
    token: "relay-token",
    allowedModels: null,
    channelId: primaryChannel.id,
    channel: primaryChannel,
    failoverConfig: {
      enabled: false,
      maxRetries: 0,
      retryStatusCodes: [],
    },
    channelConfigs: [
      {
        relayTokenId: "token-1",
        channelId: primaryChannel.id,
        priority: 0,
        channel: primaryChannel,
      },
    ],
  } as any;
};

const createService = () => {
  const relayTokenRepo = {
    updateChannelConfigUsage: vi.fn().mockResolvedValue(null),
    createSwitchLog: vi.fn().mockResolvedValue({ id: "switch-1" }),
  };
  const relayUsageRepo = {};
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
    }),
  };
  const modelPricingService = {
    getModelPricing: vi.fn().mockResolvedValue([
      {
        model: "gpt-image-1",
        provider: "gpt-image-1",
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
    resolveActiveLeafCandidates: vi.fn(async (roots: any[]) =>
      roots.filter(Boolean).map((channel: any) => ({ resolvedChannel: channel, displayChannel: channel })),
    ),
  };
  const redis = {
    isRedisAvailable: vi.fn().mockReturnValue(true),
    acquireSemaphoreSlot: vi.fn().mockResolvedValue("relay:concurrency:image:global:slot:1"),
    reserveSemaphoreQueueTicket: vi.fn().mockResolvedValue(1),
    tryAcquireQueuedSemaphoreSlot: vi.fn().mockResolvedValue("relay:concurrency:image:global:slot:1"),
    cancelSemaphoreQueueTicket: vi.fn().mockResolvedValue(true),
    deleteIfValueMatches: vi.fn().mockResolvedValue(true),
    extendIfValueMatches: vi.fn().mockResolvedValue(true),
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
    relayProxyRepository,
    relayConfigService,
    modelPricingService,
    usageChargeService,
    businessLogService,
    relayPoolResolver,
    redis,
  };
};

const createMultipartImageRequest = (body: Buffer) => {
  const req = new EventEmitter() as any;
  req.path = "/relay/proxy/v1/images/edits";
  req.originalUrl = "/relay/proxy/v1/images/edits";
  req.method = "POST";
  req.body = body;
  req.query = {};
  req.headers = {
    "content-type": "multipart/form-data; boundary=----test-boundary",
    "content-length": String(body.length),
  };
  req.ip = "127.0.0.1";
  req.connection = { remoteAddress: "127.0.0.1" };
  return req;
};

describe("RelayProxyService image runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axiosMock.mockReset();
  });

  it("extracts model from multipart buffers and forwards the raw body unchanged", async () => {
    const relayToken = createRelayToken();
    const multipartBody = Buffer.from(
      [
        "------test-boundary",
        'Content-Disposition: form-data; name="model"',
        "",
        "gpt-image-1",
        "------test-boundary",
        'Content-Disposition: form-data; name="image"; filename="cat.png"',
        "Content-Type: image/png",
        "",
        "fake-image-bytes",
        "------test-boundary--",
        "",
      ].join("\r\n"),
      "utf8",
    );
    const req = createMultipartImageRequest(multipartBody);
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

    const { service, usageChargeService, relayTokenRepo } = createService();
    const upstreamBody = Buffer.from(JSON.stringify({ data: [{ b64_json: "abc123" }] }));

    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String(upstreamBody.length),
      },
      data: Readable.from([upstreamBody]),
    });

    const result = await service.forwardRequest(relayToken, req, res);

    expect(result.status).toBe(200);
    expect(Buffer.concat(responseChunks).toString("utf8")).toBe(upstreamBody.toString("utf8"));
    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://primary.example.com/v1/images/edits",
        responseType: "stream",
        data: multipartBody,
        maxBodyLength: multipartBody.length,
      }),
    );
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        relayTokenId: "token-1",
        channelId: "channel-primary",
        modelId: "gpt-image-1",
        isStreaming: false,
      }),
    );
    expect(relayTokenRepo.updateChannelConfigUsage).toHaveBeenCalledWith({
      relayTokenId: "token-1",
      channelId: "channel-primary",
      success: true,
    });
  });

  it("rejects oversized streamed image responses before charging usage", async () => {
    const relayToken = createRelayToken();
    const req = createMultipartImageRequest(
      Buffer.from(
        [
          "------test-boundary",
          'Content-Disposition: form-data; name="model"',
          "",
          "gpt-image-1",
          "------test-boundary--",
          "",
        ].join("\r\n"),
        "utf8",
      ),
    );
    const res = new Writable({
      write(_chunk, _encoding, callback) {
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

    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
      },
      data: Readable.from([Buffer.from("12345"), Buffer.from("67890")]),
    });

    await expect(
      (service as any).forwardImageRequest(
        relayToken,
        req,
        res,
        "https://primary.example.com/v1/images/edits",
        {
          Authorization: "Bearer channel-primary-key",
          "content-type": req.headers["content-type"],
        },
        {
          pricingType: "token-based",
          input: 0.000001,
          output: 0.000002,
          multiplier: 1,
          cacheCreationMultiplier: 1.25,
          cacheReadMultiplier: 0.1,
        },
        "gpt-image-1",
        "gpt-image-1",
        1,
        req.body,
        1,
        1,
        "Primary",
        "channel-primary",
        new Date("2026-01-01T00:00:00.000Z"),
        30000,
        8,
        false,
        [],
        true,
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);

    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "content-type": "application/octet-stream",
      }),
    );
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
  });
});
