import { env } from "@/config/env";
import type { TypedRequest } from "@/types/express";
import { Permission } from "@quyan/shared";
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
  const relayChannelService = {
    assertChannelBusinessSelectableById: vi.fn(),
  };

  const OJAPIKeyServiceCtor = OJAPIKeyService as unknown as new (...args: any[]) => OJAPIKeyService;

  const service = new OJAPIKeyServiceCtor(userRepository, ojApiKeyRepository, businessLogService, relayChannelService);

  beforeEach(() => {
    vi.clearAllMocks();
    relayChannelService.assertChannelBusinessSelectableById.mockResolvedValue({ id: "channel-1" });
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
    expect(relayChannelService.assertChannelBusinessSelectableById).toHaveBeenCalledWith("channel-1", "user-1");
    expect(createPayload.key).toMatch(/^sk-ojqa-[0-9a-f]{64}$/);
    expect(result.key).toMatch(/^sk-ojqa-[0-9a-f]{64}$/);
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
    expect(relayChannelService.assertChannelBusinessSelectableById).not.toHaveBeenCalled();
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

describe("OJ API Key update rollout", () => {
  const fixture = () => {
    const keys = {
        findActiveByIdAndUserId: vi.fn().mockResolvedValue({ id: "key", userId: "actor" }),
        updateById: vi.fn().mockResolvedValue({ id: "key", userId: "actor", name: "fixture", key: "fixture-secret" }),
      },
      audit = { logOperation: vi.fn() },
      channels = { assertChannelBusinessSelectableById: vi.fn() },
      mutations = {
        update: vi.fn().mockResolvedValue({ id: "key", userId: "actor", name: "fixture" }),
        prepareUpdate: vi.fn(),
      },
      permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) },
      request = {
        user: { userId: "actor" },
        authContext: { principalUserId: "actor", accountOwnerId: "owner", roleSessionId: "session" },
        headers: {},
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as TypedRequest;
    const service = new (OJAPIKeyService as unknown as new (...args: any[]) => OJAPIKeyService)(
      {},
      keys,
      audit,
      channels,
      {},
      permissions,
      mutations,
    );
    return { keys, audit, channels, mutations, permissions, request, service };
  };
  it.each(["enforce", "legacy", "shadow"])(
    "%s uses its authorized update path without bypassing role permissions",
    async (mode) => {
      const previous = env.security.iamAuthorizationMode;
      (env.security as { iamAuthorizationMode: string }).iamAuthorizationMode = mode;
      try {
        const { service, keys, audit, mutations, permissions, request } = fixture();
        const result = await service.updateAPIKey("key", "actor", { name: "fixture" }, request);
        if (mode === "enforce") {
          expect(mutations.update).toHaveBeenCalledWith("key", "actor", { name: "fixture" }, request);
          expect(keys.findActiveByIdAndUserId).not.toHaveBeenCalled();
          expect(keys.updateById).not.toHaveBeenCalled();
          expect(result.key).toBeUndefined();
        } else {
          expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.OJ_APIKEY_UPDATE], {
            assumedRoleSessionId: "session",
          });
          expect(keys.updateById).toHaveBeenCalledExactlyOnceWith("key", { name: "fixture" });
          if (mode === "shadow")
            expect(mutations.prepareUpdate).toHaveBeenCalledWith("key", "actor", { name: "fixture" }, request);
        }
        expect(audit.logOperation).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(audit.logOperation.mock.calls)).not.toContain("fixture-secret");
      } finally {
        (env.security as { iamAuthorizationMode: string }).iamAuthorizationMode = previous;
      }
    },
  );
  it("enforce failures never fall back to legacy key hydration, mutation or audit success", async () => {
    const previous = env.security.iamAuthorizationMode;
    (env.security as { iamAuthorizationMode: string }).iamAuthorizationMode = "enforce";
    try {
      const { service, mutations, keys, audit, request } = fixture();
      mutations.update.mockRejectedValue(new Error("fixture denial"));
      await expect(service.updateAPIKey("key", "actor", {}, request)).rejects.toThrow("fixture denial");
      expect(keys.findActiveByIdAndUserId).not.toHaveBeenCalled();
      expect(keys.updateById).not.toHaveBeenCalled();
      expect(audit.logOperation).not.toHaveBeenCalled();
    } finally {
      (env.security as { iamAuthorizationMode: string }).iamAuthorizationMode = previous;
    }
  });
});

describe("OJ API Key issuance rollout", () => {
  it.each(["enforce", "legacy", "shadow"])(
    "%s preserves the appropriate issuance path and never logs credentials",
    async (mode) => {
      const previous = env.security.iamAuthorizationMode;
      (env.security as { iamAuthorizationMode: string }).iamAuthorizationMode = mode;
      try {
        const users = { findById: vi.fn().mockResolvedValue({ id: "actor" }) },
          keys = { create: vi.fn().mockResolvedValue({ id: "new-key", userId: "actor", key: "fixture-new-private" }) },
          audit = { logOperation: vi.fn() },
          channels = { assertChannelBusinessSelectableById: vi.fn() },
          permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) },
          mutations = {
            create: vi.fn().mockResolvedValue({ id: "new-key", userId: "actor", key: "fixture-new-private" }),
            prepareCreate: vi.fn(),
          },
          req = {
            user: { userId: "actor" },
            authContext: { principalUserId: "actor", accountOwnerId: "owner", roleSessionId: "session" },
            headers: {},
            ip: "127.0.0.1",
          } as unknown as TypedRequest,
          service = new (OJAPIKeyService as unknown as new (...args: any[]) => OJAPIKeyService)(
            users,
            keys,
            audit,
            channels,
            {},
            permissions,
            mutations,
          );
        const result = await service.createAPIKey("actor", "fresh", undefined, undefined, req);
        expect(result.key).toBe("fixture-new-private");
        if (mode === "enforce") {
          expect(keys.create).not.toHaveBeenCalled();
          expect(users.findById).not.toHaveBeenCalled();
          expect(mutations.create).toHaveBeenCalledWith(
            "actor",
            { name: "fresh", expiresAt: undefined, channelId: undefined },
            expect.any(String),
            req,
          );
        } else {
          expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.OJ_APIKEY_CREATE], {
            assumedRoleSessionId: "session",
          });
          expect(keys.create).toHaveBeenCalledTimes(1);
          if (mode === "shadow") expect(mutations.prepareCreate).toHaveBeenCalled();
        }
        expect(JSON.stringify(audit.logOperation.mock.calls)).not.toContain("fixture-new-private");
      } finally {
        (env.security as { iamAuthorizationMode: string }).iamAuthorizationMode = previous;
      }
    },
  );
  it("enforce failure cannot create keys or log successful issuance", async () => {
    const previous = env.security.iamAuthorizationMode;
    (env.security as { iamAuthorizationMode: string }).iamAuthorizationMode = "enforce";
    try {
      const keys = { create: vi.fn() },
        audit = { logOperation: vi.fn() },
        mutations = { create: vi.fn().mockRejectedValue(new Error("fixture denied")) },
        service = new (OJAPIKeyService as unknown as new (...args: any[]) => OJAPIKeyService)(
          {},
          keys,
          audit,
          {},
          {},
          {},
          mutations,
        );
      await expect(service.createAPIKey("actor")).rejects.toThrow("fixture denied");
      expect(keys.create).not.toHaveBeenCalled();
      expect(audit.logOperation).not.toHaveBeenCalled();
    } finally {
      (env.security as { iamAuthorizationMode: string }).iamAuthorizationMode = previous;
    }
  });
});
