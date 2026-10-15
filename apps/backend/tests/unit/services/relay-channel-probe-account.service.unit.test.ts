import { beforeEach, describe, expect, it, vi } from "vitest";
import { RelayChannelProbeAccountService } from "@/services/relay/relay-channel-probe-account.service";

const { repository, redis, login } = vi.hoisted(() => ({
  repository: { find: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  redis: {
    isRedisAvailable: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    setIfNotExists: vi.fn(),
    deleteIfValueMatches: vi.fn(),
    delete: vi.fn(),
  },
  login: vi.fn(),
}));
vi.mock("@/services/relay/platform-relay-probe-account-read-iam.service", () => ({
  PlatformRelayProbeAccountReadIamService: {
    getInstance: () => ({ list: (_request: unknown, _map: unknown, legacy: () => Promise<unknown>) => legacy() }),
  },
}));
vi.mock("@/services/relay/platform-relay-probe-account-refresh-iam.service", () => ({
  PlatformRelayProbeAccountRefreshIamService: {
    getInstance: () => ({ execute: (_id: string, _request: unknown, legacy: () => Promise<unknown>) => legacy() }),
  },
}));
vi.mock("@/services/relay/platform-relay-probe-account-create-iam.service", () => ({
  PlatformRelayProbeAccountCreateIamService: {
    getInstance: () => ({
      create: (_input: unknown, _encrypt: unknown, _request: unknown, legacy: () => Promise<unknown>) => legacy(),
    }),
  },
}));
vi.mock("@/services/relay/platform-relay-probe-account-update-iam.service", () => ({
  PlatformRelayProbeAccountUpdateIamService: {
    getInstance: () => ({
      update: (_id: string, _input: unknown, _encrypt: unknown, _request: unknown, legacy: () => Promise<unknown>) =>
        legacy(),
    }),
  },
}));
vi.mock("@/services/relay/platform-relay-probe-account-delete-iam.service", () => ({
  PlatformRelayProbeAccountDeleteIamService: {
    getInstance: () => ({ remove: (_id: string, _request: unknown, legacy: () => Promise<void>) => legacy() }),
  },
}));
vi.mock("@/store/system/server-config.repository", () => ({
  ServerConfigRepository: { getInstance: () => ({ findByKey: vi.fn(async () => null) }) },
}));
vi.mock("@/config/env", () => ({
  env: {
    runtime: { isTest: true, isDevelopment: false, logging: { disableConsoleLog: true } },
    relay: { channelProbe: { masterKey: "a".repeat(70) } },
  },
}));
vi.mock("@/store/relay/relay-channel-probe-account.repository", () => ({
  RelayChannelProbeAccountRepository: { getInstance: () => repository },
}));
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: () => redis } }));
vi.mock("@/util/developer-outbound-url", () => ({
  assertSafeOutboundUrl: vi.fn(async (url: string) => ({
    url: new URL(url),
    httpAgent: { destroy: vi.fn() },
    httpsAgent: { destroy: vi.fn() },
  })),
}));
vi.mock("axios", () => ({ default: { request: login, post: vi.fn(), isAxiosError: () => false } }));

const accountRequest = {
  name: "upstream-a",
  loginWorkflow: {
    method: "POST" as const,
    url: "https://api.example.com/login",
    body: { username: "{{username}}", password: "{{password}}" },
  },
  tokenPath: "data.token",
  expiresPath: "data.expires_in",
  expiresMode: "seconds" as const,
  fallbackTtlSeconds: 1800,
  minLoginIntervalSeconds: 300,
  credentials: { username: "alice", password: "secret-value" },
};

describe("shared probe account login", () => {
  let account: Record<string, unknown>;
  const cache = new Map<string, string>();
  beforeEach(async () => {
    vi.clearAllMocks();
    cache.clear();
    account = {};
    repository.find.mockImplementation(async () => (account.id ? account : null));
    repository.list.mockImplementation(async () => (account.id ? [account] : []));
    repository.create.mockImplementation(
      async (data: Record<string, unknown>) =>
        (account = {
          id: "account-1",
          ...data,
          lastLoginAttemptAt: null,
          createTime: new Date(),
          updateTime: new Date(),
        }),
    );
    repository.update.mockImplementation(
      async (_id: string, data: Record<string, unknown>) => (account = { ...account, ...data }),
    );
    redis.isRedisAvailable.mockReturnValue(true);
    redis.get.mockImplementation(async (key: string) => cache.get(key) ?? null);
    redis.set.mockImplementation(async (key: string, value: string) => {
      cache.set(key, value);
    });
    redis.setIfNotExists.mockImplementation(async (key: string, value: string) => {
      if (cache.has(key)) return false;
      cache.set(key, value);
      return true;
    });
    redis.deleteIfValueMatches.mockImplementation(async (key: string, value: string) => {
      if (cache.get(key) === value) cache.delete(key);
      return true;
    });
    redis.delete.mockImplementation(async (key: string) => {
      cache.delete(key);
      return 1;
    });
    login.mockResolvedValue({ data: { data: { token: "session-secret", expires_in: 900 } } });
    await RelayChannelProbeAccountService.getInstance().save(accountRequest);
  });

  it("encrypts login requests and credentials and never returns tokens or secrets in account DTOs", async () => {
    expect(account).not.toHaveProperty("loginWorkflow");
    expect(JSON.stringify(account)).not.toContain("secret-value");
    expect(JSON.stringify(account)).not.toContain("static-secret");
    const service = RelayChannelProbeAccountService.getInstance();
    expect(await service.getToken("account-1")).toBe("session-secret");
    expect(await service.getToken("account-1")).toBe("session-secret");
    expect(login).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining("session:account-1"),
      expect.not.stringContaining("session-secret"),
      expect.any(Number),
    );
    expect(JSON.stringify(await service.list())).not.toContain("secret-value");
    expect(JSON.stringify(await service.list())).not.toContain("session-secret");
  });

  it("invalidates only the observed 401 session and respects cooldown on renewal", async () => {
    const service = RelayChannelProbeAccountService.getInstance();
    await service.getToken("account-1");
    await service.invalidateSession("account-1", "stale-observation");
    expect(await service.getToken("account-1")).toBe("session-secret");
    await service.invalidateSession("account-1", "session-secret");
    await expect(service.getToken("account-1")).rejects.toThrow();
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("enforces cooldown when the cached session expires or disappears", async () => {
    const service = RelayChannelProbeAccountService.getInstance();
    await service.getToken("account-1");
    cache.delete("relay:probe-account:v1:session:account-1");
    await expect(service.getToken("account-1")).rejects.toThrow();
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("serializes two service instances through the same shared lock and session", async () => {
    let release!: (value: unknown) => void;
    login.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = new RelayChannelProbeAccountService().getToken("account-1");
    await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    const second = new RelayChannelProbeAccountService().getToken("account-1");
    release({ data: { data: { token: "shared-session", expires_in: 900 } } });
    expect(await first).toBe("shared-session");
    expect(await second).toBe("shared-session");
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("fails closed without a coordination backend or when login fails, without leaking upstream text", async () => {
    redis.isRedisAvailable.mockReturnValue(false);
    await expect(RelayChannelProbeAccountService.getInstance().getToken("account-1")).rejects.toThrow();
    expect(login).not.toHaveBeenCalled();
    redis.isRedisAvailable.mockReturnValue(true);
    login.mockRejectedValue(new Error("secret-value sent to upstream"));
    await expect(RelayChannelProbeAccountService.getInstance().getToken("account-1")).rejects.not.toThrow(
      "secret-value",
    );
  });
  it("checks native refresh authorization before reading stored credentials", async () => {
    const denied = Object.assign(new Error("fixture denied"), { statusCode: 403 });
    const guard = { recheck: vi.fn().mockRejectedValue(denied), recordAttempt: vi.fn(), publish: vi.fn() };
    repository.find.mockClear();
    await expect(RelayChannelProbeAccountService.getInstance().getToken("account-1", guard)).rejects.toBe(denied);
    expect(repository.find).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });
  it("does not dispatch a login when a native grant is revoked after DNS validation", async () => {
    const denied = Object.assign(new Error("fixture denied"), { statusCode: 403 });
    let checks = 0;
    const guard = {
      recheck: vi.fn(async () => {
        if (++checks >= 4) throw denied;
      }),
      recordAttempt: vi.fn(),
      publish: vi.fn(),
    };
    await expect(RelayChannelProbeAccountService.getInstance().getToken("account-1", guard)).rejects.toBe(denied);
    expect(login).not.toHaveBeenCalled();
    expect(guard.publish).not.toHaveBeenCalled();
  });
  it("keeps a previously cached session when authorization is revoked during upstream login", async () => {
    const service = RelayChannelProbeAccountService.getInstance();
    await service.getToken("account-1");
    account.lastLoginAttemptAt = new Date(0);
    const previous = cache.get("relay:probe-account:v1:session:account-1");
    const denied = Object.assign(new Error("fixture revoked"), { statusCode: 403 });
    const guard = { recheck: vi.fn(), recordAttempt: vi.fn(), publish: vi.fn() };
    login.mockImplementationOnce(async () => {
      guard.recheck.mockRejectedValue(denied);
      return { data: { data: { token: "revoked-session", expires_in: 900 } } };
    });
    await expect(service.getToken("account-1", guard)).rejects.toBe(denied);
    expect(cache.get("relay:probe-account:v1:session:account-1")).toBe(previous);
    expect(guard.publish).not.toHaveBeenCalled();
  });
  it("rejects a lost login lease before publishing a native refresh", async () => {
    const guard = { recheck: vi.fn(), recordAttempt: vi.fn(), publish: vi.fn() };
    login.mockImplementationOnce(async () => {
      cache.set("relay:probe-account:v1:login:account-1", "newer-owner");
      return { data: { data: { token: "stale-session", expires_in: 900 } } };
    });
    await expect(RelayChannelProbeAccountService.getInstance().getToken("account-1", guard)).rejects.toThrow();
    expect(guard.publish).not.toHaveBeenCalled();
    expect(cache.get("relay:probe-account:v1:login:account-1")).toBe("newer-owner");
  });
  it("does not return the old cache as a successful forced refresh when another login owns the lease", async () => {
    const service = RelayChannelProbeAccountService.getInstance();
    await service.getToken("account-1");
    account.lastLoginAttemptAt = new Date(0);
    cache.set("relay:probe-account:v1:login:account-1", "another-login");
    login.mockClear();
    await expect(
      service.getToken("account-1", { recheck: vi.fn(), recordAttempt: vi.fn(), publish: vi.fn() }),
    ).rejects.toThrow();
    expect(login).not.toHaveBeenCalled();
  });
});
