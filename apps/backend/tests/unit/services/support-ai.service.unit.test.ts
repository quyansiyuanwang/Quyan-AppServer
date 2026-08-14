import { describe, expect, it, vi } from "vitest";
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
  sessionRetentionDays: 3,
  inputPricePerMillion: 0,
  outputPricePerMillion: 0,
};

const SupportAiServiceCtor = SupportAiService as unknown as new (...args: any[]) => SupportAiService;

const createService = () => {
  const configService = { getMultiple: vi.fn(), set: vi.fn() };
  const aiProvider = { streamChat: vi.fn() };
  const ticketService = { createTicket: vi.fn() };
  const redisService = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
  const usageRepository = { create: vi.fn(), getAnalytics: vi.fn() };
  const service = new SupportAiServiceCtor(configService, aiProvider, ticketService, redisService, usageRepository);
  return { service, configService, aiProvider, redisService };
};

describe("SupportAiService conversation retention", () => {
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

  it("persists only bounded message history with the configured 1-7 day TTL", async () => {
    const { service, aiProvider, redisService } = createService();
    vi.spyOn(service, "getConfig").mockResolvedValue(config);
    vi.spyOn(service as any, "searchDocumentation").mockResolvedValue([]);
    vi.spyOn(service as any, "decrypt").mockReturnValue("upstream-key");
    vi.spyOn(service as any, "values").mockResolvedValue({});
    redisService.get.mockImplementation(async (key: string) =>
      key.startsWith("support-ai:conversation:")
        ? JSON.stringify({ messages: [{ role: "assistant", content: "Prior answer" }] })
        : "0",
    );
    async function* stream() {
      yield { done: false, content: "Create a Relay Token first." };
      yield { done: true };
    }
    aiProvider.streamChat.mockReturnValue(stream());

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
    expect(aiProvider.streamChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant", content: "Prior answer" }),
        expect.objectContaining({ role: "user", content: "How do I call AI?" }),
      ]),
      config.model,
      "upstream-key",
      config.upstreamUrl,
      config.requestFormat,
      undefined,
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
