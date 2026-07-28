import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    developerProject: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    developerProductConfig: { findUnique: vi.fn() },
    developerQuotaUsage: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    developerQuotaOverride: { findFirst: vi.fn() },
    balanceAccount: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    balanceTransaction: { create: vi.fn() },
    developerProjectApiKey: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    developerKvEntry: { findFirst: vi.fn(), delete: vi.fn() },
    developerShortLink: { findFirst: vi.fn(), updateMany: vi.fn() },
    developerShortLinkClick: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    developerSecret: { upsert: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    developerVerification: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    developerPushChannel: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    developerPushDelivery: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    developerPushRequest: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  },
  axios: {
    get: vi.fn(),
    post: vi.fn(),
    request: vi.fn(),
  },
  redis: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
}));

vi.mock("../../../src/config/database", () => ({ prisma: mocks.prisma }));
vi.mock("../../../src/services/infrastructure/redis.service", () => ({
  RedisService: { getInstance: () => mocks.redis },
}));
vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return { ...actual, default: { ...actual.default, ...mocks.axios } };
});

import { DeveloperProjectService } from "../../../src/services/developer/developer-project.service";
import { EnvSpace } from "../../../src/config/env";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("DeveloperProjectService", () => {
  const originalDeveloperProductConfig = EnvSpace.developerProductConfig;
  const originalBaiduMapConfig = EnvSpace.baiduMapConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(mocks.prisma));
    (DeveloperProjectService as any).serviceInstance = undefined;
    process.env.DEVELOPER_SECRETS_MASTER_KEY = "d".repeat(64);
    delete process.env.IP_GEOLOCATION_ENDPOINT;
    (EnvSpace as any).developerProductConfig = {
      ...originalDeveloperProductConfig,
      ipGeolocationEndpoint: "",
    };
    (EnvSpace as any).baiduMapConfig = {
      ...originalBaiduMapConfig,
      ipLocationAk: "",
    };
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
    expect(mocks.prisma.developerProjectApiKey.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "key-1", status: 1 } }),
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
    (service as any).configService = { get: vi.fn().mockResolvedValue("0.5") };
    const receipt = await (service as any).consumeQuota("project-1", "ip");

    expect(receipt).toMatchObject({ usageId: "usage-1", userId: "user-1", chargeAmount: 0.5 });
    expect(mocks.prisma.balanceAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) }),
    );
    expect(mocks.prisma.balanceTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "developer_overage", model: "developer:ip" }) }),
    );
  });

  it("retries the first daily quota upsert in a new transaction after a concurrent create", async () => {
    mocks.prisma.developerProject.findUnique.mockResolvedValue({
      id: "project-1",
      userId: "user-1",
      dailyFreeQuota: 2,
      overageEnabled: false,
    });
    mocks.prisma.developerQuotaOverride.findFirst.mockResolvedValue(null);
    mocks.prisma.developerQuotaUsage.upsert
      .mockRejectedValueOnce({ code: "P2002" })
      .mockResolvedValueOnce({ id: "usage-1", requestCount: 1 });

    const service = DeveloperProjectService.getInstance();
    (service as any).configService = { get: vi.fn().mockResolvedValue("0") };

    await expect((service as any).consumeQuota("project-1", "ip")).resolves.toMatchObject({ usageId: "usage-1" });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.developerQuotaUsage.upsert).toHaveBeenCalledTimes(2);
  });

  it("treats expired KV entries as missing and removes them", async () => {
    const expired = { id: "kv-1", expiresAt: new Date(Date.now() - 1) };
    mocks.prisma.developerKvEntry.findFirst.mockResolvedValue(expired);

    await expect(DeveloperProjectService.getInstance().getKv("project-1", "config")).rejects.toThrow("KV 键不存在");
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
    expect(mocks.prisma.developerSecret.updateMany).toHaveBeenCalled();
  });

  it("substitutes aliases in nested JSON values without exposing the secret in metadata", async () => {
    mocks.prisma.developerProject.findFirst.mockResolvedValue({ id: "project-1" });
    const service = DeveloperProjectService.getInstance();
    (service as any).resolveSecret = vi.fn().mockResolvedValue("secret-value");

    await expect(
      service.substituteSecretsInJsonValue("project-1", "user-1", {
        headers: { authorization: "Bearer {{OPENAI_KEY}}" },
        messages: ["{{OPENAI_KEY}}", "plain"],
      }),
    ).resolves.toEqual({
      headers: { authorization: "Bearer secret-value" },
      messages: ["secret-value", "plain"],
    });
    (service as any).resolveSecret.mockRejectedValueOnce(new Error("未定义的密钥别名: MISSING_KEY"));
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
    mocks.prisma.developerVerification.updateMany.mockResolvedValue({ count: 1 });
    const service = DeveloperProjectService.getInstance();

    await expect(
      service.verifyCode("project-1", {
        channel: "email",
        recipient: "user@example.com",
        purpose: "login",
        code: "000000",
      }),
    ).resolves.toBe(false);
    expect(mocks.prisma.developerVerification.updateMany).toHaveBeenCalledWith(
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
    expect(mocks.prisma.developerVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { consumedAt: expect.any(Date) } }),
    );
  });

  it("does not validate a verification code already consumed by a concurrent request", async () => {
    mocks.prisma.developerVerification.findFirst.mockResolvedValue({
      id: "verification-1",
      codeHash: sha256("123456"),
      remainingTries: 3,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.prisma.developerVerification.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      DeveloperProjectService.getInstance().verifyCode("project-1", {
        channel: "email",
        recipient: "user@example.com",
        purpose: "login",
        code: "123456",
      }),
    ).resolves.toBe(false);
    expect(mocks.prisma.developerVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ consumedAt: null, remainingTries: { gt: 0 } }) }),
    );
  });

  it("does not consume IP quota when the provider is unavailable or the IP is not public", async () => {
    const service = DeveloperProjectService.getInstance();
    const consumeQuota = vi.spyOn(service as any, "consumeQuota");
    await expect(service.lookupIp("project-1", "8.8.8.8")).rejects.toThrow("IP 定位服务尚未配置");
    await expect(service.lookupIp("project-1", "169.254.169.254")).rejects.toThrow("仅支持公网 IP 地址");
    expect(consumeQuota).not.toHaveBeenCalled();
  });

  it("returns the shared 24-hour IP cache without calling the provider again", async () => {
    mocks.redis.get.mockResolvedValue(
      JSON.stringify({ ip: "8.8.8.8", country: "United States", region: "California", city: "Mountain View" }),
    );
    const service = DeveloperProjectService.getInstance();
    const consumeQuota = vi.spyOn(service as any, "consumeQuota");
    consumeQuota.mockResolvedValue({
      projectId: "project-1",
      service: "ip",
      usageId: "usage-1",
      userId: "user-1",
      chargeAmount: 0,
    });

    await expect(service.lookupIp("project-1", "8.8.8.8")).resolves.toMatchObject({ country: "United States" });

    expect(consumeQuota).toHaveBeenCalledWith("project-1", "ip");
    expect(mocks.axios.get).not.toHaveBeenCalled();
    expect(mocks.redis.get).toHaveBeenCalledWith("developer:ip-location:8.8.8.8");
  });

  it("stores a successful IP lookup in the shared cache for one day", async () => {
    mocks.redis.get.mockResolvedValue(null);
    mocks.axios.get.mockResolvedValue({
      data: { country_name: "United States", region: "California", city: "Mountain View" },
    });
    const service = DeveloperProjectService.getInstance();
    vi.spyOn(service as any, "consumeQuota").mockResolvedValue({
      projectId: "project-1",
      service: "ip",
      usageId: "usage-1",
      userId: "user-1",
      chargeAmount: 0,
    });
    (EnvSpace as any).developerProductConfig = {
      ...originalDeveloperProductConfig,
      ipGeolocationEndpoint: "https://8.8.8.8",
    };

    await expect(service.lookupIp("project-1", "8.8.8.8")).resolves.toMatchObject({ country: "United States" });

    expect(mocks.redis.set).toHaveBeenCalledWith(
      "developer:ip-location:8.8.8.8",
      expect.stringContaining('"country":"United States"'),
      24 * 60 * 60,
    );
  });

  it("refunds IP quota when the configured provider request fails", async () => {
    const service = DeveloperProjectService.getInstance();
    const receipt = { projectId: "project-1", service: "ip", usageId: "usage-1", userId: "user-1", chargeAmount: 1 };
    vi.spyOn(service as any, "consumeQuota").mockResolvedValue(receipt);
    const refundQuota = vi.spyOn(service as any, "refundQuota").mockResolvedValue(undefined);
    mocks.axios.get.mockRejectedValue(new Error("provider unavailable"));
    (EnvSpace as any).developerProductConfig = {
      ...originalDeveloperProductConfig,
      ipGeolocationEndpoint: "https://8.8.8.8",
    };

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
    mocks.prisma.developerProductConfig.findUnique.mockResolvedValue({ enabled: true });
    mocks.prisma.developerProject.findFirst.mockResolvedValue({
      name: "Example API",
      slug: "example-api",
      productInstance: {
        enabled: true,
        status: 1,
        entitlement: { productCode: "status", status: 1 },
      },
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

  it("aggregates short-link visits by IP and returns a paginated detail list", async () => {
    mocks.prisma.developerProject.findFirst.mockResolvedValue({ id: "project-1" });
    mocks.prisma.developerShortLink.findFirst.mockResolvedValue({ id: "link-1", code: "docs", clickCount: 8 });
    mocks.prisma.developerShortLinkClick.groupBy
      .mockResolvedValueOnce([{ sourceHost: "example.com", _count: { id: 3 } }])
      .mockResolvedValueOnce([{ country: "CN", _count: { id: 2 } }])
      .mockResolvedValueOnce([{ ipAddress: "203.0.113.7", _count: { id: 2 } }]);
    mocks.prisma.developerShortLinkClick.count.mockResolvedValue(3);
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([{ count: 2n }])
      .mockResolvedValueOnce([{ bucket: "2026-07-23", count: 3n }])
      .mockResolvedValueOnce([{ bucket: "08:00", count: 2n }]);
    mocks.prisma.developerShortLinkClick.findMany.mockResolvedValue([
      {
        clickedAt: new Date("2026-07-23T08:00:00.000Z"),
        ipAddress: "203.0.113.7",
        sourceHost: "example.com",
        country: "CN",
        userAgent: "Test Browser",
      },
      {
        clickedAt: new Date("2026-07-23T10:00:00.000Z"),
        ipAddress: "198.51.100.8",
        sourceHost: null,
        country: null,
        userAgent: null,
      },
    ]);

    const stats = await DeveloperProjectService.getInstance().getShortLinkStats("project-1", "link-1", "user-1", 2, 25);

    expect(stats.totalClicks).toBe(8);
    expect(stats.uniqueVisitors).toBe(2);
    expect(stats.totalRecords).toBe(3);
    expect(stats.page).toBe(2);
    expect(stats.pageSize).toBe(25);
    expect(stats.clicksByDay).toEqual([{ date: "2026-07-23", count: 3 }]);
    expect(stats.clicksByHour).toEqual([{ hour: "08:00", count: 2 }]);
    expect(stats.sources).toEqual([{ sourceHost: "example.com", count: 3 }]);
    expect(stats.countries).toEqual([{ country: "CN", count: 2 }]);
    expect(stats.ipAddresses).toEqual([{ ipAddress: "203.0.113.7", count: 2 }]);
    expect(stats.recentClicks[1].ipAddress).toBe("198.51.100.8");
    expect(mocks.prisma.developerShortLinkClick.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 25, take: 25 }),
    );
  });
});
