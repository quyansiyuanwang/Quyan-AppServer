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
});
