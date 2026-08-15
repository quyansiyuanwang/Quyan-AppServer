import { createHash } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../src/config/env";
import { SupportAiService } from "../../../src/services/support/support-ai.service";

const config = {
  enabled: true,
  upstreamUrl: "https://upstream.example.test/v1",
  apiKeyConfigured: true,
  model: "support-model",
  requestFormat: "openai-chat-completions" as const,
  systemPrompt: "",
  maxRequests: 20,
  windowSeconds: 600,
  maxAgentRounds: 3,
  maxOutputTokens: 2048,
  allowUserBalance: false,
  allowUserRelayToken: false,
  sessionRetentionDays: 3,
  inputPricePerMillion: 0,
  outputPricePerMillion: 0,
};

const SupportAiServiceCtor = SupportAiService as unknown as new (...args: any[]) => SupportAiService;

const supportKnowledgeConfig = env.integrations.supportKnowledge as { url: string; cacheTtlSeconds: number };
const originalSupportKnowledgeConfig = { ...supportKnowledgeConfig };

afterEach(() => {
  Object.assign(supportKnowledgeConfig, originalSupportKnowledgeConfig);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const createService = () => {
  const configService = { getMultiple: vi.fn(), set: vi.fn() };
  const aiProvider = { streamChat: vi.fn() };
  const ticketService = { createTicket: vi.fn() };
  const redisService = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
  const usageRepository = { create: vi.fn(), getAnalytics: vi.fn() };
  const relayTokenService = { validateToken: vi.fn() };
  const service = new SupportAiServiceCtor(
    configService,
    aiProvider,
    ticketService,
    redisService,
    usageRepository,
    relayTokenService,
  );
  return { service, configService, aiProvider, redisService, relayTokenService };
};

describe("SupportAiService conversation retention", () => {
  it("uses a hashed manifest and only downloads knowledge chunks when its version changes", async () => {
    const { service } = createService();
    supportKnowledgeConfig.url = "https://docs.example.test/support-knowledge.json";
    const chunks = [
      {
        id: "zh-CN:relay-token:0",
        slug: "relay-token",
        title: "中转令牌",
        locale: "zh-CN",
        path: "/zh-CN/relay-token",
        content: "创建中转令牌。",
      },
    ];
    const version = `sha256-${createHash("sha256").update(JSON.stringify(chunks)).digest("hex")}`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version, chunksUrl: `./support-knowledge.${version.slice(7)}.json` }), {
          headers: { etag: '"manifest-v1"' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(chunks)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version, chunksUrl: `./support-knowledge.${version.slice(7)}.json` })),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect((service as any).loadKnowledge()).resolves.toEqual(chunks);
    (service as any).knowledgeCacheExpiresAt = 0;
    await expect((service as any).loadKnowledge()).resolves.toEqual(chunks);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0].toString()).toBe(
      `https://docs.example.test/support-knowledge.${version.slice(7)}.json`,
    );
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ headers: { "If-None-Match": '"manifest-v1"' } });
  });

  it("reuses cached knowledge after a conditional manifest request returns 304", async () => {
    const { service } = createService();
    supportKnowledgeConfig.url = "https://docs.example.test/support-knowledge.json";
    const chunks = [
      {
        id: "en:relay-token:0",
        slug: "relay-token",
        title: "Relay token",
        locale: "en",
        path: "/en/relay-token",
        content: "Create a Relay Token.",
      },
    ];
    const version = `sha256-${createHash("sha256").update(JSON.stringify(chunks)).digest("hex")}`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version, chunksUrl: "./support-knowledge.chunks.json" }), {
          headers: { etag: '"manifest-v1"' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(chunks)))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);

    await (service as any).loadKnowledge();
    (service as any).knowledgeCacheExpiresAt = 0;
    await expect((service as any).loadKnowledge()).resolves.toEqual(chunks);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ headers: { "If-None-Match": '"manifest-v1"' } });
  });

  it("exposes only search metadata and reads bounded excerpts from prior candidates", async () => {
    const { service } = createService();
    vi.spyOn(service as any, "loadKnowledge").mockResolvedValue([
      {
        id: "zh-CN:relay-token:0",
        slug: "relay-token",
        title: "中转令牌",
        locale: "zh-CN",
        path: "/zh-CN/relay-token",
        content: `创建令牌。${"a".repeat(1400)}`,
      },
      {
        id: "en:relay-token:0",
        slug: "relay-token",
        title: "Relay token",
        locale: "en",
        path: "/en/relay-token",
        content: "Create a token.",
      },
    ]);

    const searchResults = await (service as any).searchDocumentation("token", "zh-CN");
    expect(searchResults).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "zh-CN:relay-token:0", slug: "relay-token" })]),
    );
    expect(searchResults[0]).not.toHaveProperty("content");

    const documents = await (service as any).readDocumentation(searchResults);
    expect(documents).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "zh-CN:relay-token:0", content: expect.any(String) })]),
    );
    expect(documents[0].content).toHaveLength(1200);
  });

  it("prefers documentation in the requested locale before cross-language relevance scores", async () => {
    const { service } = createService();
    vi.spyOn(service as any, "loadKnowledge").mockResolvedValue([
      {
        slug: "relay-token-en",
        title: "Relay token guide",
        locale: "en",
        path: "/relay-token-en",
        content: "token token token",
      },
      {
        slug: "relay-token-zh",
        title: "中转令牌指南",
        locale: "zh-CN",
        path: "/relay-token-zh",
        content: "token",
      },
    ]);

    await expect((service as any).searchDocumentation("token", "zh-CN")).resolves.toMatchObject([
      { slug: "relay-token-zh", locale: "zh-CN" },
      { slug: "relay-token-en", locale: "en" },
    ]);
  });

  it("loads valid Redis history, ignores malformed content, and clears only the user's key", async () => {
    const { service, redisService } = createService();
    redisService.get.mockResolvedValueOnce(
      JSON.stringify({ messages: [{ role: "user", content: "Where is my token?" }] }),
    );

    await expect(service.getConversation("user-1")).resolves.toEqual({
      messages: [{ role: "user", content: "Where is my token?" }],
    });

    redisService.get.mockResolvedValueOnce("not-json");
    await expect(service.getConversation("user-1")).resolves.toEqual({ messages: [] });

    await service.clearConversation("user-1");
    expect(redisService.delete).toHaveBeenCalledWith("support-ai:conversation:user-1");
  });

  it("runs a bounded agent loop that searches, reads only approved chunks, then streams the final answer", async () => {
    const { service, aiProvider, redisService } = createService();
    supportKnowledgeConfig.url = "https://docs.example.test/support-knowledge.json";
    vi.spyOn(service, "getConfig").mockResolvedValue({ ...config, maxAgentRounds: 3, maxOutputTokens: 512 });
    vi.spyOn(service as any, "decrypt").mockReturnValue("upstream-key");
    vi.spyOn(service as any, "values").mockResolvedValue({});
    redisService.get.mockResolvedValue("0");
    const candidate = {
      id: "zh-CN:relay-token:0",
      slug: "relay-token",
      title: "中转令牌",
      locale: "zh-CN",
      path: "/zh-CN/relay-token",
      score: 10,
    };
    vi.spyOn(service as any, "searchDocumentation").mockResolvedValue([candidate]);
    vi.spyOn(service as any, "readDocumentation").mockResolvedValue([
      { ...candidate, content: "在中转令牌管理页面点击创建令牌。" },
    ]);
    const modelStream = (content: string) =>
      (async function* () {
        yield { done: false as const, content };
        yield { done: true as const, inputTokens: 3, outputTokens: 2 };
      })();
    aiProvider.streamChat
      .mockReturnValueOnce(modelStream('{"tool":"documentation_search","query":"创建令牌"}'))
      .mockReturnValueOnce(modelStream('{"tool":"documentation_outline","ids":["zh-CN:relay-token:0"]}'))
      .mockReturnValueOnce(modelStream('{"tool":"documentation_read","ids":["zh-CN:relay-token:0"]}'))
      .mockReturnValueOnce(modelStream("请在中转令牌管理页面点击“创建令牌”。"));

    const events = [];
    for await (const event of service.stream("user-1", { content: "我在哪里创建令牌？", locale: "zh-CN" }))
      events.push(event);

    expect(events).toEqual(
      expect.arrayContaining([
        { type: "status", stage: "thinking", round: 1 },
        { type: "status", stage: "searching", round: 1 },
        { type: "status", stage: "reading", round: 2 },
        { type: "status", stage: "reading", round: 3 },
        { type: "status", stage: "generating" },
        { type: "delta", content: "请在中转令牌管理页面点击“创建令牌”。" },
      ]),
    );
    expect((service as any).searchDocumentation).toHaveBeenCalledWith("创建令牌", "zh-CN");
    expect((service as any).readDocumentation).toHaveBeenCalledWith(
      [candidate],
      ["zh-CN:relay-token:0"],
      expect.arrayContaining([expect.objectContaining({ id: "zh-CN:relay-token:0" })]),
    );
    expect(aiProvider.streamChat.mock.calls[0]?.[6]).toEqual({ maxOutputTokens: 512 });
    expect(aiProvider.streamChat.mock.calls[3]?.[6]).toEqual({ maxOutputTokens: 512 });
  });

  it("uses the manifest and language indexes before fetching only the selected document sections", async () => {
    const { service } = createService();
    supportKnowledgeConfig.url = "https://docs.example.test/support-knowledge.json";
    const documentPayload = {
      schemaVersion: 2,
      id: "zh-CN:relay-token",
      slug: "relay-token",
      title: "中转令牌",
      locale: "zh-CN",
      path: "/zh-CN/relay-token",
      sections: [
        {
          id: "zh-CN:relay-token:0",
          heading: "创建令牌",
          summary: "在中转令牌管理页面创建令牌。",
          content: "在中转令牌管理页面点击创建令牌，然后复制令牌。",
        },
      ],
    };
    const documentHash = `sha256-${createHash("sha256").update(JSON.stringify(documentPayload)).digest("hex")}`;
    const zhIndex = {
      schemaVersion: 2,
      locale: "zh-CN",
      documents: [
        {
          id: "zh-CN:relay-token",
          slug: "relay-token",
          title: "中转令牌",
          locale: "zh-CN",
          path: "/zh-CN/relay-token",
          summary: "创建和管理中转令牌。",
          sectionCount: 1,
          documentUrl: "./support-knowledge.document.zh-CN.relay-token.json",
          documentHash,
        },
      ],
    };
    const enIndex = { schemaVersion: 2, locale: "en", documents: [] };
    const hash = (value: unknown) => `sha256-${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
    const manifest = {
      schemaVersion: 2,
      version: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      locales: {
        "zh-CN": { indexUrl: "./support-knowledge.index.zh-CN.json", indexHash: hash(zhIndex) },
        en: { indexUrl: "./support-knowledge.index.en.json", indexHash: hash(enIndex) },
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest)))
      .mockResolvedValueOnce(new Response(JSON.stringify(zhIndex)))
      .mockResolvedValueOnce(new Response(JSON.stringify(enIndex)))
      .mockResolvedValueOnce(new Response(JSON.stringify(documentPayload)));
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await (service as any).searchDocumentation("创建令牌", "zh-CN");
    expect(candidates).toMatchObject([{ id: "zh-CN:relay-token", title: "中转令牌" }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const outlines = await (service as any).outlineDocumentation(candidates, ["zh-CN:relay-token"]);
    expect(outlines).toMatchObject([{ id: "zh-CN:relay-token:0", heading: "创建令牌" }]);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await expect(
      (service as any).readDocumentation(candidates, ["zh-CN:relay-token:0"], outlines),
    ).resolves.toMatchObject([
      { id: "zh-CN:relay-token:0", content: "在中转令牌管理页面点击创建令牌，然后复制令牌。" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("uses a current-user Relay Token only when both user-funded controls are enabled", async () => {
    const { service, relayTokenService } = createService();
    relayTokenService.validateToken.mockResolvedValue({ userId: "user-1" });
    const userFundedConfig = { ...config, allowUserBalance: true, allowUserRelayToken: true };
    const request = { ip: "198.51.100.12", socket: { remoteAddress: "198.51.100.12" } } as any;

    await expect(
      (service as any).resolveModelProvider(
        "user-1",
        {
          fundingMode: "user-relay",
          relayToken: "rlt_owned-token",
          relayBaseUrl: "https://ai.qysyw.test",
          relayModel: "gpt-4o-mini",
        },
        userFundedConfig,
        request,
      ),
    ).resolves.toMatchObject({
      apiKey: "rlt_owned-token",
      upstreamUrl: "https://ai.qysyw.test",
      model: "gpt-4o-mini",
      requestFormat: "openai-chat-completions",
      requestHeaders: expect.objectContaining({
        "x-appserver-support-client-ip": "198.51.100.12",
        "x-appserver-support-relay": expect.any(String),
      }),
    });

    await expect(
      (service as any).resolveModelProvider(
        "user-1",
        {
          fundingMode: "user-relay",
          relayToken: "rlt_owned-token",
          relayBaseUrl: "https://ai.qysyw.test",
          relayModel: "gpt-4o-mini",
        },
        config,
        request,
      ),
    ).rejects.toThrow("User-funded AI support is disabled");
  });

  it("persists only bounded message history with the configured 1-7 day TTL", async () => {
    const { service, aiProvider, redisService } = createService();
    vi.spyOn(service, "getConfig").mockResolvedValue(config);
    vi.spyOn(service as any, "decrypt").mockReturnValue("upstream-key");
    vi.spyOn(service as any, "values").mockResolvedValue({});
    redisService.get.mockImplementation(async (key: string) =>
      key.startsWith("support-ai:conversation:")
        ? JSON.stringify({ messages: [{ role: "assistant", content: "Prior answer" }] })
        : "0",
    );
    async function* plannerStream() {
      yield { done: false, content: '{"tool":"final"}' };
      yield { done: true, inputTokens: 11, outputTokens: 3 };
    }
    async function* responseStream() {
      yield { done: false, content: "Create a Relay Token first." };
      yield { done: true, inputTokens: 12, outputTokens: 5 };
    }
    aiProvider.streamChat.mockReturnValueOnce(plannerStream()).mockReturnValueOnce(responseStream());

    const events = [];
    for await (const event of service.stream("user-1", {
      content: "How do I call AI?",
      history: [{ role: "user", content: "Untrusted browser history" }],
      page: { visibleText: "Create token Button Internal page text" },
    }))
      events.push(event);

    expect(events).toEqual(
      expect.arrayContaining([
        { type: "delta", content: "Create a Relay Token first." },
        { type: "complete", done: true },
      ]),
    );
    expect(aiProvider.streamChat).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant", content: "Prior answer" }),
        expect.objectContaining({ role: "user", content: "How do I call AI?" }),
      ]),
      config.model,
      "upstream-key",
      config.upstreamUrl,
      config.requestFormat,
      undefined,
      { maxOutputTokens: config.maxOutputTokens },
    );
    expect(JSON.stringify(redisService.set.mock.calls)).not.toContain("Untrusted browser history");
    expect(JSON.stringify(redisService.set.mock.calls)).not.toContain("Internal page text");
    expect(redisService.set).toHaveBeenLastCalledWith(
      "support-ai:conversation:user-1",
      JSON.stringify({
        messages: [
          { role: "assistant", content: "Prior answer" },
          { role: "user", content: "How do I call AI?" },
          { role: "assistant", content: "Create a Relay Token first." },
        ],
      }),
      3 * 24 * 60 * 60,
    );
  });
});
