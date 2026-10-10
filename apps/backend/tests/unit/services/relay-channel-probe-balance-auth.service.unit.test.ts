import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayChannelProbeService } from "@/services/relay/relay-channel-probe.service";
import { RelayChannelProbeAccountService } from "@/services/relay/relay-channel-probe-account.service";

vi.mock("@/util/developer-outbound-url", () => ({
  assertSafeOutboundUrl: vi.fn(async (url: string) => ({
    url: new URL(url),
    httpAgent: { destroy: vi.fn() },
    httpsAgent: { destroy: vi.fn() },
  })),
}));

describe("balance 401 account-session handling", () => {
  afterEach(() => vi.restoreAllMocks());
  const workflow = [
    {
      name: "balance",
      method: "GET" as const,
      url: "https://example.com/balance",
      headers: { Authorization: "Bearer {{accountToken}}" },
      balancePath: "data.balance",
    },
  ];
  const read = (variables: Record<string, string>, steps = workflow) =>
    (
      RelayChannelProbeService.getInstance() as unknown as {
        readBalanceSnapshot: (steps: typeof workflow, vars: Record<string, string>) => Promise<unknown>;
      }
    ).readBalanceSnapshot(steps, variables);

  it("distinguishes a shared balance token 401 from an ordinary upstream failure", async () => {
    const upstream401 = Object.assign(new Error("upstream error with secret-value"), {
      isAxiosError: true,
      response: { status: 401 },
    });
    vi.spyOn(axios, "request").mockRejectedValue(upstream401);
    await expect(read({ accountToken: "secret-value" })).rejects.toMatchObject({
      message: "PROBE_BALANCE_AUTH_EXPIRED",
    });
    await expect(read({}, [{ ...workflow[0], headers: { Authorization: "Bearer static" } }])).rejects.toBe(upstream401);
  });

  it("uses the shared token only for the balance request and extracts a numeric balance", async () => {
    const request = vi.spyOn(axios, "request").mockResolvedValue({ data: { data: { balance: 9.5 } } });
    await expect(read({ accountToken: "secret-value" })).resolves.toMatchObject({ balance: 9.5 });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { Authorization: "Bearer secret-value" },
      }),
    );
  });

  it("measures a mocked balance and priced model request using separate shared-session and upstream credentials", async () => {
    const service = RelayChannelProbeService.getInstance();
    const internal = service as unknown as {
      createPricingSnapshot: (...args: unknown[]) => Promise<Record<string, unknown>>;
      calculateBaseCost: (...args: unknown[]) => Promise<{ baseCost: number; breakdown: Record<string, unknown> }>;
      executeSamples: (
        profile: unknown,
        run: unknown,
        pricing: unknown,
        accountId: string,
      ) => Promise<{
        succeededCount: number;
        suggestedMultiplier?: number;
        samples: unknown[];
      }>;
    };
    vi.spyOn(internal, "createPricingSnapshot").mockResolvedValue({ model: "gpt-test" });
    vi.spyOn(internal, "calculateBaseCost").mockResolvedValue({ baseCost: 1, breakdown: {} });
    const session = vi
      .spyOn(RelayChannelProbeAccountService.getInstance(), "getToken")
      .mockResolvedValue("session-secret");
    let reads = 0;
    const balance = vi.spyOn(axios, "request").mockImplementation(async () => {
      reads += 1;
      return { data: { data: { balance: reads < 3 ? 100 : 99 } } };
    });
    const model = vi.spyOn(axios, "post").mockResolvedValue({
      data: {
        usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
      },
    });
    const profile = {
      id: "profile",
      relayChannelId: "channel",
      probeFormat: "openai-chat-completions",
      probeEndpoint: "openai-chat-completions",
      probeModel: "gpt-test",
      probePayload: {
        messages: [{ role: "user", content: "probe" }],
      },
      workflow,
      balanceSettlementTolerance: 0.000001,
      balanceSettlementReads: 2,
      measurementInputTokens: 0,
      upstreamBalanceDivisor: 1,
      upstreamRateMultiplier: 1,
      upstreamCurrency: "CNY",
      localCurrency: "CNY",
      relayChannel: {
        id: "channel",
        channelType: "standalone",
        openaiUpstreamUrl: "https://api.example.com/v1",
        openaiUpstreamApiKey: "upstream-key",
      },
    };
    const run = {
      sampleCount: 1,
      probeMemberChannelId: null,
      cacheMode: "allow-cache",
      distributionMultiplier: 1,
      probeEndpoint: "openai-chat-completions",
      forceWithoutCacheBuster: false,
      strictCalibrationValidation: false,
    };
    const result = await internal.executeSamples(profile, run, { rate: {}, upstreamModelId: "gpt-test" }, "account-1");
    expect(result.succeededCount).toBe(1);
    expect(result.suggestedMultiplier).toBe(1);
    expect(session).toHaveBeenCalledOnce();
    expect(balance).toHaveBeenCalledTimes(4);
    expect(balance).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { Authorization: "Bearer session-secret" },
      }),
    );
    expect(model).toHaveBeenCalledWith(
      expect.stringContaining("/chat/completions"),
      expect.anything(),
      expect.objectContaining({ headers: { Authorization: "Bearer upstream-key" } }),
    );
  }, 15_000);
  it("does not resend a potentially billed model request after the balance token returns 401", async () => {
    const internal = RelayChannelProbeService.getInstance() as unknown as {
      createPricingSnapshot: (...args: unknown[]) => Promise<Record<string, unknown>>;
      readSettledBalance: (...args: unknown[]) => Promise<{ balance: number; snapshots: unknown[] }>;
      callUpstream: (...args: unknown[]) => Promise<unknown>;
      executeSamples: (
        profile: unknown,
        run: unknown,
        pricing: unknown,
        accountId: string,
      ) => Promise<{
        succeededCount: number;
        samples: unknown[];
      }>;
    };
    vi.spyOn(internal, "createPricingSnapshot").mockResolvedValue({});
    vi.spyOn(internal, "readSettledBalance")
      .mockResolvedValueOnce({ balance: 100, snapshots: [] })
      .mockRejectedValueOnce(new Error("PROBE_BALANCE_AUTH_EXPIRED"));
    const model = vi.spyOn(internal, "callUpstream").mockResolvedValue({
      response: {
        usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
      },
      measurementInputInjected: true,
    });
    vi.spyOn(RelayChannelProbeAccountService.getInstance(), "getToken").mockResolvedValue("expired-token");
    const invalidate = vi
      .spyOn(RelayChannelProbeAccountService.getInstance(), "invalidateSession")
      .mockResolvedValue(undefined);
    const result = await internal.executeSamples(
      {
        relayChannelId: "channel",
        probeFormat: "openai-chat-completions",
        probeModel: "gpt-test",
        relayChannel: { id: "channel", channelType: "standalone" },
        workflow,
        balanceSettlementTolerance: 0.000001,
        balanceSettlementReads: 2,
      },
      {
        sampleCount: 3,
        probeMemberChannelId: null,
        cacheMode: "allow-cache",
        distributionMultiplier: 1,
        probeEndpoint: "openai-chat-completions",
        forceWithoutCacheBuster: false,
        strictCalibrationValidation: false,
      },
      { rate: {}, upstreamModelId: "gpt-test" },
      "account-1",
    );
    expect(model).toHaveBeenCalledTimes(1);
    expect(result.samples).toHaveLength(1);
    expect(result.succeededCount).toBe(0);
    expect(invalidate).toHaveBeenCalledWith("account-1", "expired-token");
  }, 10_000);
});
