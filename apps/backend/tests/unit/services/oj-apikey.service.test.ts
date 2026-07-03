import { beforeEach, describe, expect, it, vi } from "vitest";
import { OJAPIKeyService } from "../../../src/services/oj-submitter/oj-apikey.service";
import { NotFoundError } from "../../../src/util/errors";

describe("OJAPIKeyService", () => {
  const userRepository = {
    findById: vi.fn(),
  };

  const ojApiKeyRepository = {
    create: vi.fn(),
    listActiveByUserId: vi.fn(),
    findActiveByIdAndUserId: vi.fn(),
    softDeleteById: vi.fn(),
    updateById: vi.fn(),
    countActiveByUserId: vi.fn(),
    countActiveUnexpiredByUserId: vi.fn(),
    aggregateUsageByUserId: vi.fn(),
  };
  const businessLogService = {
    logOperation: vi.fn(),
  };

  const OJAPIKeyServiceCtor = OJAPIKeyService as unknown as new (...args: any[]) => OJAPIKeyService;

  const service = new OJAPIKeyServiceCtor(userRepository, ojApiKeyRepository, businessLogService);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates API key with ojqa prefix and forwards optional fields", async () => {
    const expiresAt = new Date("2026-05-01T00:00:00.000Z");
    userRepository.findById.mockResolvedValue({ id: "user-1" });
    ojApiKeyRepository.create.mockImplementation(async (data) => ({
      id: "key-1",
      requestCount: 0,
      totalTokens: 0,
      lastUsedAt: null,
      createTime: new Date("2026-04-16T00:00:00.000Z"),
      channel: { name: "channel-a" },
      ...data,
    }));

    const result = await service.createAPIKey("user-1", "main", expiresAt, "channel-1");

    expect(userRepository.findById).toHaveBeenCalledWith("user-1");
    const createPayload = ojApiKeyRepository.create.mock.calls[0][0];
    expect(createPayload.userId).toBe("user-1");
    expect(createPayload.name).toBe("main");
    expect(createPayload.expiresAt).toBe(expiresAt);
    expect(createPayload.channelId).toBe("channel-1");
    expect(createPayload.key).toMatch(/^ojqa_[0-9a-f]{64}$/);
    expect(result.key).toMatch(/^ojqa_[0-9a-f]{64}$/);
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: "OJ_APIKEY_CREATE",
        actorUserId: "user-1",
      }),
    );
  });

  it("throws when creating API key for missing user", async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(service.createAPIKey("missing-user")).rejects.toThrow(NotFoundError);
    expect(ojApiKeyRepository.create).not.toHaveBeenCalled();
  });

  it("lists API keys for a user", async () => {
    ojApiKeyRepository.listActiveByUserId.mockResolvedValue([{ id: "key-1" }, { id: "key-2" }]);

    const result = await service.listAPIKeys("user-1");

    expect(ojApiKeyRepository.listActiveByUserId).toHaveBeenCalledWith("user-1");
    expect(result).toHaveLength(2);
  });

  it("throws when requested API key does not belong to user", async () => {
    ojApiKeyRepository.findActiveByIdAndUserId.mockResolvedValue(null);

    await expect(service.getAPIKey("key-1", "user-1")).rejects.toThrow(NotFoundError);
  });

  it("soft deletes API key after ownership check", async () => {
    ojApiKeyRepository.findActiveByIdAndUserId.mockResolvedValue({ id: "key-1", userId: "user-1" });

    const result = await service.deleteAPIKey("key-1", "user-1");

    expect(ojApiKeyRepository.softDeleteById).toHaveBeenCalledWith("key-1");
    expect(result).toEqual({ success: true });
  });

  it("updates API key with nullable fields", async () => {
    const expiresAt = new Date("2026-06-01T00:00:00.000Z");
    ojApiKeyRepository.findActiveByIdAndUserId.mockResolvedValue({ id: "key-1", userId: "user-1" });
    ojApiKeyRepository.updateById.mockResolvedValue({
      id: "key-1",
      userId: "user-1",
      name: "renamed",
      expiresAt,
      channelId: null,
    });

    const result = await service.updateAPIKey("key-1", "user-1", {
      name: "renamed",
      expiresAt,
      channelId: null,
    });

    expect(ojApiKeyRepository.updateById).toHaveBeenCalledWith("key-1", {
      name: "renamed",
      expiresAt,
      channelId: null,
    });
    expect(result.name).toBe("renamed");
    expect(result.expiresAt).toBe(expiresAt);
  });

  it("aggregates API key stats", async () => {
    ojApiKeyRepository.countActiveByUserId.mockResolvedValue(5);
    ojApiKeyRepository.countActiveUnexpiredByUserId.mockResolvedValue(3);
    ojApiKeyRepository.aggregateUsageByUserId.mockResolvedValue({
      requestCount: 12,
      totalTokens: 3456,
    });

    const result = await service.getAPIKeyStats("user-1");

    expect(result).toEqual({
      totalKeys: 5,
      activeKeys: 3,
      totalRequests: 12,
      totalTokens: 3456,
    });
  });
});
