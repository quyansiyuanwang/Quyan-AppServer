import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    developerProject: { findFirst: vi.fn(), findUnique: vi.fn() },
    developerQuotaUsage: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    developerQuotaOverride: { findFirst: vi.fn() },
    balanceAccount: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    balanceTransaction: { create: vi.fn() },
    developerProjectApiKey: { findFirst: vi.fn(), update: vi.fn() },
    developerKvEntry: { findFirst: vi.fn(), delete: vi.fn() },
    developerShortLink: { findFirst: vi.fn() },
    developerShortLinkClick: { groupBy: vi.fn(), findMany: vi.fn() },
    developerSecret: { upsert: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    developerVerification: { findFirst: vi.fn(), update: vi.fn() },
    developerPushChannel: { findMany: vi.fn() },
    developerPushDelivery: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    developerPushRequest: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  },
  axios: {
    get: vi.fn(),
    post: vi.fn(),
    request: vi.fn(),
  },
}));

vi.mock("../../../src/config/database", () => ({ prisma: mocks.prisma }));
vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return { ...actual, default: { ...actual.default, ...mocks.axios } };
});

import { DeveloperProjectService } from "../../../src/services/developer/developer-project.service";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("DeveloperProjectService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(mocks.prisma));
    (DeveloperProjectService as any).serviceInstance = undefined;
    process.env.DEVELOPER_SECRETS_MASTER_KEY = "d".repeat(64);
    delete process.env.IP_GEOLOCATION_ENDPOINT;
  });

  it("authenticates a project key only when it contains the requested scope", async () => {
    mocks.prisma.developerProjectApiKey.findFirst.mockResolvedValue({
      id: "key-1",
      keyHash: sha256("dk_test"),
      scopes: ["kv:read"],
      expiresAt: null,
      project: { userId: "user-1" },
    });

    const service = DeveloperProjectService.getInstance();
    const key = await service.authenticateProjectKey("dk_test", ["kv:read"]);

    expect(key.id).toBe("key-1");
    expect(mocks.prisma.developerProjectApiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "key-1" } }),
    );
    await expect(service.authenticateProjectKey("dk_test", ["push:send"])).rejects.toThrow("缺少权限");
  });

  it("prefers project quota overrides over user overrides and defaults", async () => {
    mocks.prisma.developerProject.findFirst.mockResolvedValue({
      id: "project-1",
      userId: "user-1",
      dailyFreeQuota: 1000,
      overageEnabled: false,
    });
    mocks.prisma.developerQuotaUsage.findMany.mockResolvedValue([
      { service: "verification", requestCount: 18 },
      { service: "ip", requestCount: 12 },
    ]);
    mocks.prisma.developerQuotaOverride.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.subjectType === "project" && where.service.in.includes("verification")) return { dailyFreeQuota: 20 };
      if (where.subjectType === "user") return { dailyFreeQuota: 50 };
      return null;
    });

    const summary = await DeveloperProjectService.getInstance().getQuotaSummary("project-1", "user-1");

    expect(summary.usages).toEqual([
      { service: "verification", requestCount: 18, dailyFreeQuota: 20, remainingFree: 2 },
      { service: "ip", requestCount: 12, dailyFreeQuota: 50, remainingFree: 38 },
      { service: "push", requestCount: 0, dailyFreeQuota: 50, remainingFree: 50 },
    ]);
  });

  it("charges an overage atomically and records a balance transaction", async () => {
    mocks.prisma.developerProject.findUnique.mockResolvedValue({
      id: "project-1",
      userId: "user-1",
      dailyFreeQuota: 2,
      overageEnabled: true,
    });
    mocks.prisma.developerQuotaOverride.findFirst.mockResolvedValue(null);
    mocks.prisma.developerQuotaUsage.upsert.mockResolvedValue({ id: "usage-1", requestCount: 3 });
    mocks.prisma.balanceAccount.findUnique.mockResolvedValue({ balance: 5 });
    mocks.prisma.balanceAccount.updateMany.mockResolvedValue({ count: 1 });

    const service = DeveloperProjectService.getInstance();
    ;(service as any).configService = { get: vi.fn().mockResolvedValue("0.5") };
    const receipt = await (service as any).consumeQuota("project-1", "ip");

    expect(receipt).toMatchObject({ usageId: "usage-1", userId: "user-1", chargeAmount: 0.5 });
    expect(mocks.prisma.balanceAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) }),
    );
    expect(mocks.prisma.balanceTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "developer_overage", model: "developer:ip" }) }),
    );
  });

  it("treats expired KV entries as missing and removes them", async () => {
    const expired = { id: "kv-1", expiresAt: new Date(Date.now() - 1) };
    mocks.prisma.developerKvEntry.findFirst.mockResolvedValue(expired);

    await expect(DeveloperProjectService.getInstance().getKv("project-1", "config")).rejects.toThrow(
      "KV 键不存在",
    );
    expect(mocks.prisma.developerKvEntry.delete).toHaveBeenCalledWith({ where: { id: "kv-1" } });
  });

  it("encrypts secrets at rest and decrypts them only for substitution", async () => {
    const now = new Date();
    mocks.prisma.developerProject.findFirst.mockResolvedValue({ id: "project-1" });
    mocks.prisma.developerSecret.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "secret-1",
      alias: create.alias,
      keyVersion: 1,
      lastUsedAt: null,
      createTime: now,
      updateTime: now,
      ciphertext: create.ciphertext,
      iv: create.iv,
      authTag: create.authTag,
    }));

    const service = DeveloperProjectService.getInstance();
    const listed = await service.upsertSecret("project-1", "user-1", { alias: "OPENAI_KEY", value: "secret-value" });
    const encrypted = mocks.prisma.developerSecret.upsert.mock.calls[0][0].create;
    mocks.prisma.developerSecret.findFirst.mockResolvedValue({
      id: "secret-1",
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });

    expect(listed).not.toHaveProperty("value");
    await expect(service.resolveSecret("project-1", "OPENAI_KEY")).resolves.toBe("secret-value");
    expect(mocks.prisma.developerSecret.update).toHaveBeenCalled();
  });

  it("substitutes aliases in nested JSON values without exposing the secret in metadata", async () => {
    mocks.prisma.developerProject.findFirst.mockResolvedValue({ id: "project-1" });
    const service = DeveloperProjectService.getInstance();
    ;(service as any).resolveSecret = vi.fn().mockResolvedValue("secret-value");

    await expect(
      service.substituteSecretsInJsonValue("project-1", "user-1", {
        headers: { authorization: "Bearer {{OPENAI_KEY}}" },
        messages: ["{{OPENAI_KEY}}", "plain"],
      }),
    ).resolves.toEqual({
      headers: { authorization: "Bearer secret-value" },
      messages: ["secret-value", "plain"],
    });
    ;(service as any).resolveSecret.mockRejectedValueOnce(new Error("未定义的密钥别名: MISSING_KEY"));
    await expect(service.substituteSecretsForProject("project-1", "user-1", "{{MISSING_KEY}}")).rejects.toThrow(
      "未定义的密钥别名",
    );
  });

  it("consumes a verification code once and decrements wrong attempts", async () => {
    const record = {
      id: "verification-1",
      codeHash: sha256("123456"),
      remainingTries: 3,
      expiresAt: new Date(Date.now() + 60_000),
    };
    mocks.prisma.developerVerification.findFirst.mockResolvedValue(record);
    const service = DeveloperProjectService.getInstance();

    await expect(
      service.verifyCode("project-1", {
        channel: "email",
        recipient: "user@example.com",
        purpose: "login",
        code: "000000",
      }),
    ).resolves.toBe(false);
    expect(mocks.prisma.developerVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { remainingTries: { decrement: 1 } } }),
    );

    await expect(
      service.verifyCode("project-1", {
        channel: "email",
        recipient: "user@example.com",
        purpose: "login",
        code: "123456",
      }),
    ).resolves.toBe(true);
    expect(mocks.prisma.developerVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { consumedAt: expect.any(Date) } }),
    );
  });

  it("does not consume IP quota when the provider is unavailable or the IP is not public", async () => {
    const service = DeveloperProjectService.getInstance();
    const consumeQuota = vi.spyOn(service as any, "consumeQuota");
    process.env.IP_GEOLOCATION_ENDPOINT = "";

    await expect(service.lookupIp("project-1", "8.8.8.8")).rejects.toThrow("IP 定位服务尚未配置");
    await expect(service.lookupIp("project-1", "169.254.169.254")).rejects.toThrow("仅支持公网 IP 地址");
    expect(consumeQuota).not.toHaveBeenCalled();
  });

  it("refunds IP quota when the configured provider request fails", async () => {
    const service = DeveloperProjectService.getInstance();
    const receipt = { projectId: "project-1", service: "ip", usageId: "usage-1", userId: "user-1", chargeAmount: 1 };
    vi.spyOn(service as any, "consumeQuota").mockResolvedValue(receipt);
    const refundQuota = vi.spyOn(service as any, "refundQuota").mockResolvedValue(undefined);
    mocks.axios.get.mockRejectedValue(new Error("provider unavailable"));
    process.env.IP_GEOLOCATION_ENDPOINT = "https://8.8.8.8";

    await expect(service.lookupIp("project-1", "1.1.1.1")).rejects.toThrow("provider unavailable");
    expect(refundQuota).toHaveBeenCalledWith(receipt);
  });

  it("refunds push quota when delivery persistence fails before dispatch", async () => {
    const service = DeveloperProjectService.getInstance();
    const receipt = { projectId: "project-1", service: "push", usageId: "usage-1", userId: "user-1", chargeAmount: 1 };
    vi.spyOn(service as any, "consumeQuota").mockResolvedValue(receipt);
    const refundQuota = vi.spyOn(service as any, "refundQuota").mockResolvedValue(undefined);
    mocks.prisma.developerPushChannel.findMany.mockResolvedValue([{ id: "channel-1" }]);
    mocks.prisma.developerPushDelivery.create.mockRejectedValue(new Error("database unavailable"));

    await expect(
      service.sendPush("project-1", {
        channelIds: ["channel-1"],
        title: "Test",
        content: "Delivery",
      }),
    ).rejects.toThrow("database unavailable");
    expect(refundQuota).toHaveBeenCalledWith(receipt);
  });

  it("exposes recent status checks and calculates public availability", async () => {
    mocks.prisma.developerProject.findFirst.mockResolvedValue({
      name: "Example API",
      slug: "example-api",
      statusMonitors: [
        {
          name: "Health",
          lastStatus: "up",
          lastCheckedAt: new Date(),
          checks: [
            { checkStatus: "up", statusCode: 200, latencyMs: 42, checkedAt: new Date() },
            { checkStatus: "down", statusCode: 503, latencyMs: 71, checkedAt: new Date() },
          ],
        },
      ],
    });

    const page = await DeveloperProjectService.getInstance().getPublicStatusPage("example-api");

    expect(page.statusMonitors[0].availability).toBe(0.5);
    expect(page.statusMonitors[0].checks).toHaveLength(2);
  });

  it("aggregates short-link clicks by day, source and country without IP data", async () => {
    mocks.prisma.developerProject.findFirst.mockResolvedValue({ id: "project-1" });
    mocks.prisma.developerShortLink.findFirst.mockResolvedValue({ id: "link-1", code: "docs", clickCount: 8 });
    mocks.prisma.developerShortLinkClick.groupBy
      .mockResolvedValueOnce([{ sourceHost: "example.com", _count: { id: 3 } }])
      .mockResolvedValueOnce([{ country: "CN", _count: { id: 2 } }]);
    mocks.prisma.developerShortLinkClick.findMany.mockResolvedValue([
      {
        clickedAt: new Date("2026-07-23T08:00:00.000Z"),
        sourceHost: "example.com",
        country: "CN",
        userAgent: "Test Browser",
      },
      {
        clickedAt: new Date("2026-07-23T10:00:00.000Z"),
        sourceHost: null,
        country: null,
        userAgent: null,
      },
    ]);

    const stats = await DeveloperProjectService.getInstance().getShortLinkStats("project-1", "link-1", "user-1");

    expect(stats.totalClicks).toBe(8);
    expect(stats.clicksByDay).toEqual([{ date: "2026-07-23", count: 2 }]);
    expect(stats.sources).toEqual([{ sourceHost: "example.com", count: 3 }]);
    expect(stats.countries).toEqual([{ country: "CN", count: 2 }]);
    expect(stats.recentClicks[1]).not.toHaveProperty("ipAddress");
  });
});
