import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    developerProject: { findFirst: vi.fn() },
    developerProjectApiKey: { findFirst: vi.fn(), update: vi.fn() },
    developerKvEntry: { findFirst: vi.fn(), delete: vi.fn() },
    developerShortLink: { findFirst: vi.fn() },
    developerShortLinkClick: { groupBy: vi.fn(), findMany: vi.fn() },
    developerSecret: { upsert: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    developerVerification: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../../../src/config/database", () => ({ prisma: mocks.prisma }));

import { DeveloperProjectService } from "../../../src/services/developer/developer-project.service";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("DeveloperProjectService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (DeveloperProjectService as any).serviceInstance = undefined;
    process.env.DEVELOPER_SECRETS_MASTER_KEY = "d".repeat(64);
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
