import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  inbox: vi.fn(),
  log: vi.fn(),
  finish: vi.fn(),
  email: vi.fn(),
  preference: vi.fn(),
  account: vi.fn(),
  webhooks: vi.fn(),
}));
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mocks.email }) } }));
vi.mock("@/store/notification/notification-preference.repository", () => ({
  NotificationPreferenceRepository: {
    getInstance: () => ({
      ensureRoundInbox: mocks.inbox,
      ensureRoundLog: mocks.log,
      finishRoundLog: mocks.finish,
      activeAccountEmail: mocks.account,
      findWebhooksByUserId: mocks.webhooks,
    }),
  },
}));
vi.mock("@/services/notification/notification-preference-initializer.service", () => ({
  NotificationPreferenceInitializerService: { getInstance: () => ({ getOrInitialize: mocks.preference }) },
}));
vi.mock("@/services/system/config.service", () => ({
  ConfigService: {
    getInstance: () => ({
      getSmtpConfig: async () => ({
        host: "fixture.invalid",
        senderEmail: "no-reply@example.invalid",
        senderName: "Fixture",
      }),
      getSiteConfig: async () => ({ backendPublicUrl: "https://fixture.invalid" }),
    }),
  },
}));
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: () => ({}) } }));
import { NotificationService } from "@/services/notification/notification.service";
import { NotificationTemplateRegistry } from "@/services/notification/notification-template";
import { NotificationEvent } from "@quyan/shared";
const event = NotificationEvent.RELAY_PROBE_ROUND_COMPLETED;
const input = {
  roundId: "fixture-round",
  scheduledFor: "2026-11-02T19:00:00Z",
  detailsUrl: "https://fixture.invalid/round",
  targets: [
    {
      id: "target",
      channelId: "channel",
      channelName: "Fixture channel",
      state: "failed",
      balanceBefore: 12,
      balanceAfter: 11,
      balanceDelta: 1,
      inputTokens: 100,
      outputTokens: 10,
      measuredMultiplier: 1,
      suggestedMultiplier: 2,
      previousSuggestedMultiplier: 1.5,
      multiplierChange: 1,
      multiplierChangePercent: 100,
      suggestionChange: 0.5,
      suggestionChangePercent: 33.333,
      calibrationStatus: "verified",
      errorStage: "balance",
      errorCode: "upstream-http-401",
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.preference.mockResolvedValue({ notificationEmail: null, subscribedEvents: [event] });
  mocks.account.mockResolvedValue({ email: "account@example.invalid" });
  mocks.log.mockResolvedValue({ deliveryStatus: "pending" });
  mocks.email.mockResolvedValue({});
  mocks.webhooks.mockResolvedValue([]);
});
describe("registered round notification", () => {
  it("renders numeric data, changes, failure stage and report link in the event document", () => {
    const document = NotificationTemplateRegistry.build(event, input);
    const serialized = JSON.stringify(document);
    for (const value of ["Fixture channel", "100", "33.333", "upstream-http-401", "balance", input.detailsUrl])
      expect(serialized).toContain(value);
  });
  it("uses account email fallback and a stable inbox/log without event-wide Redis cooldown", async () => {
    const recheck = vi.fn(async () => {});
    await expect(
      NotificationService.getInstance().dispatchProbeRound("actor", "delivery", input, recheck),
    ).resolves.toBe("delivered");
    expect(mocks.inbox).toHaveBeenCalledWith("delivery", expect.objectContaining({ eventType: event }));
    expect(mocks.log).toHaveBeenCalledWith("delivery-email", expect.objectContaining({ channel: "email" }));
    expect(mocks.email).toHaveBeenCalledWith(
      expect.objectContaining({ to: "account@example.invalid", messageId: "<delivery@example.invalid>" }),
    );
    expect(recheck).toHaveBeenCalledTimes(2);
  });
  it("retries a failed delivery but does not resend an already successful log", async () => {
    mocks.email.mockRejectedValueOnce(new Error("fixture-secret-response"));
    await expect(
      NotificationService.getInstance().dispatchProbeRound("actor", "delivery", input, async () => {}),
    ).rejects.toThrow();
    expect(mocks.finish).toHaveBeenCalledWith("delivery-email", "failed", "notification-delivery-failed");
    mocks.log.mockResolvedValue({ deliveryStatus: "success" });
    await NotificationService.getInstance().dispatchProbeRound("actor", "delivery", input, async () => {});
    expect(mocks.email).toHaveBeenCalledTimes(1);
  });
  it("preserves inbox results but respects an explicitly unsubscribed email event", async () => {
    mocks.preference.mockResolvedValue({ subscribedEvents: [], notificationEmail: "account@example.invalid" });
    expect(await NotificationService.getInstance().dispatchProbeRound("actor", "delivery", input, async () => {})).toBe(
      "unsubscribed",
    );
    expect(mocks.inbox).toHaveBeenCalledOnce();
    expect(mocks.email).not.toHaveBeenCalled();
  });
});
