import { assertProbeRunExecution, withProbeRunExecution } from "@/services/relay/relay-probe-execution-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: vi.fn() } }));
vi.mock("@/config/database", () => ({ prisma: {} }));
import { parseProbeRunAdmission, RelayProbeRunAdmissionStore } from "@/services/relay/relay-probe-run-admission";
import { RELAY_PROBE_QUEUE_POLICY } from "@/services/relay/relay-channel-probe-queue-policy";
const fixture = () => ({
  version: 1 as const,
  runId: "run",
  channelId: "channel",
  memberChannelId: null,
  profileId: "profile",
  profileUpdatedAt: new Date(0).toISOString(),
  targetConfigId: null,
  targetConfigUpdatedAt: null,
  accountId: null,
  principal: {
    subjectUserId: "actor",
    principalUserId: "actor",
    accountOwnerId: "owner",
    subjectType: "sub_user" as const,
  },
  identity: { principalUpdatedAt: new Date(0).toISOString(), ownerUpdatedAt: new Date(0).toISOString() },
  transport: { "acs:SecureTransport": true, "acs:SourceIp": "192.0.2.1" },
  expiresAt: Date.now() + 60_000,
});
const redis = { getWithResult: vi.fn(), setIfNotExists: vi.fn(), deleteIfValueMatches: vi.fn() };
const store = new RelayProbeRunAdmissionStore(redis);
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());
describe("server-owned probe admission", () => {
  it("accepts bounded server principal and transport metadata", () => {
    expect(parseProbeRunAdmission(fixture())).toEqual(fixture());
  });
  it.each([
    { token: "fixture-not-a-token" },
    { password: "fixture-not-a-password" },
    { action: "fake:*" },
    { expiresAt: 0 },
    { expiresAt: NaN },
    { expiresAt: Infinity },
    { runId: "../other" },
    { memberChannelId: "*" },
    { profileUpdatedAt: "invalid" },
    { version: 2 },
    { accountId: "account" },
    { targetConfigId: "config" },
  ])("rejects malformed, secret-bearing or inconsistent fields %j", (patch) => {
    expect(() => parseProbeRunAdmission({ ...fixture(), ...patch })).toThrow();
  });
  it("rejects expired and overlong validity windows", () => {
    expect(() => parseProbeRunAdmission({ ...fixture(), expiresAt: Date.now() })).toThrow();
    expect(() =>
      parseProbeRunAdmission({ ...fixture(), expiresAt: Date.now() + RELAY_PROBE_QUEUE_POLICY.slotTtlMs + 1 }),
    ).toThrow();
  });
  it.each([
    { subjectType: "root" },
    { subjectType: "assumed_role" },
    { roleSessionId: "session" },
    { assumedRoleId: "role" },
    { subjectUserId: "other" },
    { jwt: "fixture" },
  ])("rejects inconsistent or untrusted principal %j", (patch) => {
    const input = fixture();
    expect(() => parseProbeRunAdmission({ ...input, principal: { ...input.principal, ...patch } })).toThrow();
  });
  it("accepts a complete role session identity", () => {
    const input = fixture();
    expect(
      parseProbeRunAdmission({
        ...input,
        principal: { ...input.principal, subjectType: "assumed_role", assumedRoleId: "role", roleSessionId: "session" },
      }).principal.subjectType,
    ).toBe("assumed_role");
  });
  it.each([
    { "acs:SourceIp": "not-ip" },
    { "acs:UserAgent": "bad\nagent" },
    { "acs:SecureTransport": "true" },
    { "acs:CurrentTime": "2026-10-15" },
  ])("rejects client condition injection %j", (patch) => {
    const input = fixture();
    expect(() => parseProbeRunAdmission({ ...input, transport: { ...input.transport, ...patch } })).toThrow();
  });
  it("stores with NX and a millisecond TTL; undo uses exact CAS", async () => {
    redis.setIfNotExists.mockResolvedValue(true);
    redis.deleteIfValueMatches.mockResolvedValue(false);
    const input = fixture(),
      undo = await store.save(input);
    expect(redis.setIfNotExists).toHaveBeenCalledWith(
      "relay:probe-run-admission:v1:run",
      JSON.stringify(parseProbeRunAdmission(input)),
      60_000,
    );
    await undo();
    expect(redis.deleteIfValueMatches).toHaveBeenCalledWith(
      "relay:probe-run-admission:v1:run",
      JSON.stringify(parseProbeRunAdmission(input)),
    );
  });
  it.each([false, null])("does not overwrite or accept unavailable admission storage %j", async (value) => {
    redis.setIfNotExists.mockResolvedValue(value);
    await expect(store.save(fixture())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([null, { value: null }, { value: "{" }, { value: "x".repeat(8193) }, { value: "{}" }])(
    "fails closed on missing/unavailable/corrupt state",
    async (value) => {
      redis.getWithResult.mockResolvedValue(value);
      await expect(store.read("run")).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("revalidates expiry on each storage read", async () => {
    redis.getWithResult.mockResolvedValue({ value: JSON.stringify(fixture()) });
    await expect(store.read("run")).resolves.toMatchObject({ runId: "run" });
    vi.advanceTimersByTime(60_001);
    await expect(store.read("run")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps async execution guards isolated and propagates revocation", async () => {
    const first = vi.fn().mockResolvedValue(undefined),
      second = vi.fn().mockRejectedValue(new Error("revoked"));
    await Promise.all([
      withProbeRunExecution(first, async () => {
        await Promise.resolve();
        await assertProbeRunExecution();
      }),
      withProbeRunExecution(second, async () => {
        await expect(assertProbeRunExecution()).rejects.toThrow("revoked");
      }),
    ]);
    await assertProbeRunExecution();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
  it("AccessKey admission requires paired key id and non-secret revision", () => {
    const input = fixture(),
      principal = { ...input.principal, subjectType: "access_key" };
    expect(() => parseProbeRunAdmission({ ...input, principal })).toThrow();
    expect(() =>
      parseProbeRunAdmission({ ...input, principal, identity: { ...input.identity, accessKeyId: "key" } }),
    ).toThrow();
    expect(
      parseProbeRunAdmission({
        ...input,
        principal,
        identity: { ...input.identity, accessKeyId: "key", accessKeyRevision: "a".repeat(64) },
      }).principal.subjectType,
    ).toBe("access_key");
  });
});
