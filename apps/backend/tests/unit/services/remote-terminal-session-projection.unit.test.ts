import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteTerminalSessionGateway } from "@/modules/remote-terminal/gateway/session-gateway";
import type { RemoteTerminalDeviceRegistry } from "@/modules/remote-terminal/gateway/device-registry";
import { RedisService } from "@/services/infrastructure/redis.service";
import {
  parseTerminalSessionProjections,
  terminalSessionRedisKey,
  type TerminalSessionMetadata,
} from "@/services/infrastructure/remote-terminal-session-projection";
import type { WebSocket } from "ws";
const metadata = (id = "session-1"): TerminalSessionMetadata => ({
  sessionId: id,
  ownerUserId: "user-1",
  entitlementId: "entitlement-1",
  deviceId: "device-1",
  status: "pending",
  revision: "redis:" + "a".repeat(40),
});
const summary = (id = "session-1") => ({
  sessionId: id,
  deviceId: "device-1",
  mode: "shell" as const,
  shellType: "bash" as const,
  status: "pending" as const,
  createdAt: "2026-10-14T00:00:00.000Z",
});
describe("safe terminal session projection", () => {
  const redis = {
    scanKeyPageWithResult: vi.fn(),
    projectTerminalSessions: vi.fn(),
    get: vi.fn(),
    getKeysByPattern: vi.fn(),
    isRedisAvailable: vi.fn().mockReturnValue(true),
    set: vi.fn().mockResolvedValue(undefined),
  };
  const registry = {
    getAccessibleDevice: vi.fn(),
    markOnline: vi.fn().mockResolvedValue(undefined),
  } as unknown as RemoteTerminalDeviceRegistry;
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(RedisService, "getInstance").mockReturnValue(redis as unknown as RedisService);
    redis.scanKeyPageWithResult.mockResolvedValue({ cursor: "0", keys: [] });
    redis.projectTerminalSessions.mockResolvedValue([]);
  });
  it("reads metadata across all cursor pages and deduplicates scan keys", async () => {
    redis.scanKeyPageWithResult
      .mockResolvedValueOnce({ cursor: "4", keys: [terminalSessionRedisKey("session-1")] })
      .mockResolvedValueOnce({
        cursor: "0",
        keys: [terminalSessionRedisKey("session-1"), terminalSessionRedisKey("session-2")],
      });
    redis.projectTerminalSessions
      .mockResolvedValueOnce([{ state: "present", metadata: metadata() }])
      .mockResolvedValueOnce([{ state: "present", metadata: metadata("session-2") }]);
    const gateway = new RemoteTerminalSessionGateway(registry);
    expect(await gateway.listSessionMetadata("user-1")).toEqual([metadata(), metadata("session-2")]);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.getKeysByPattern).not.toHaveBeenCalled();
  });
  it("does not truncate native scans to the legacy global 500 session limit", async () => {
    const keys = Array.from({ length: 701 }, (_, index) => terminalSessionRedisKey("session-" + index));
    redis.scanKeyPageWithResult.mockResolvedValue({ cursor: "0", keys });
    redis.projectTerminalSessions.mockImplementation(async (_owner, batch: string[]) =>
      batch.map((key) => ({ state: "present", metadata: metadata(key.split(":").at(-1)) })),
    );
    expect(await new RemoteTerminalSessionGateway(registry).listSessionMetadata("user-1")).toHaveLength(701);
    expect(redis.projectTerminalSessions.mock.calls.map((call) => call[1].length)).toEqual([500, 201]);
  });
  it.each([null, { cursor: "0", keys: [terminalSessionRedisKey("session-1")] }])(
    "fails closed on unavailable/invalid metadata (%j)",
    async (page) => {
      redis.scanKeyPageWithResult.mockResolvedValue(page);
      redis.projectTerminalSessions.mockResolvedValue([{ state: "invalid" }]);
      await expect(new RemoteTerminalSessionGateway(registry).listSessionMetadata("user-1")).rejects.toThrow();
    },
  );
  it("ignores confirmed foreign and expired entries", async () => {
    redis.scanKeyPageWithResult.mockResolvedValue({
      cursor: "0",
      keys: [terminalSessionRedisKey("session-1"), terminalSessionRedisKey("session-2")],
    });
    redis.projectTerminalSessions.mockResolvedValue([{ state: "foreign" }, { state: "missing" }]);
    expect(await new RemoteTerminalSessionGateway(registry).listSessionMetadata("user-1")).toEqual([]);
  });
  it("rejects cycling scan cursors", async () => {
    redis.scanKeyPageWithResult.mockResolvedValue({ cursor: "7", keys: [] });
    await expect(new RemoteTerminalSessionGateway(registry).listSessionMetadata("user-1")).rejects.toThrow();
    expect(redis.scanKeyPageWithResult).toHaveBeenCalledTimes(2);
  });
  it("hydrates only explicitly selected keys with expected source revisions", async () => {
    redis.projectTerminalSessions.mockResolvedValue([{ state: "present", metadata: metadata(), summary: summary() }]);
    expect(await new RemoteTerminalSessionGateway(registry).hydrateSessionSummaries("user-1", [metadata()])).toEqual([
      summary(),
    ]);
    expect(redis.projectTerminalSessions).toHaveBeenCalledWith(
      "user-1",
      [terminalSessionRedisKey("session-1")],
      [metadata().revision],
    );
  });
  it.each(["missing", "foreign", "changed", "invalid"])("rejects %s admitted source", async (state) => {
    redis.projectTerminalSessions.mockResolvedValue([{ state }]);
    await expect(
      new RemoteTerminalSessionGateway(registry).hydrateSessionSummaries("user-1", [metadata()]),
    ).rejects.toThrow();
  });
  it("rejects mismatched source identity even if an adapter supplies the expected revision", async () => {
    redis.projectTerminalSessions.mockResolvedValue([
      { state: "present", metadata: { ...metadata(), deviceId: "device-2" }, summary: summary() },
    ]);
    await expect(
      new RemoteTerminalSessionGateway(registry).hydrateSessionSummaries("user-1", [metadata()]),
    ).rejects.toThrow();
  });
  it("preserves live precedence without reading private properties", async () => {
    registry.getAccessibleDevice = vi.fn().mockResolvedValue({
      entitlementId: "entitlement-1",
      online: true,
      snapshot: { diagnostics: { availableShells: ["bash"] } },
    });
    const gateway = new RemoteTerminalSessionGateway(registry);
    gateway.attachAgent("device-1", { on: vi.fn(), send: vi.fn(), close: vi.fn() } as unknown as WebSocket);
    const created = await gateway.createSession(
      "user-1",
      { deviceId: "device-1", mode: "shell", shellType: "bash" },
      "ws://fixture",
    );
    const record = (gateway as unknown as { sessions: Map<string, object> }).sessions.get(created.sessionId)!;
    for (const field of ["browserToken", "workingDirectory"])
      Object.defineProperty(record, field, {
        get: () => {
          throw new Error("Private field hydrated");
        },
      });
    const rows = await gateway.listSessionMetadata("user-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].revision).toMatch(/^live:/);
    expect(await gateway.hydrateSessionSummaries("user-1", rows)).toEqual([
      { ...summary(created.sessionId), createdAt: created.createdAt },
    ]);
  });
  it("strictly parses projections and strips undeclared private fields", () => {
    const parsed = parseTerminalSessionProjections(
      [
        JSON.stringify({
          state: "present",
          metadata: { ...metadata(), browserToken: "fixture-private" },
          summary: { ...summary(), workingDirectory: "fixture-private" },
        }),
      ],
      1,
    );
    expect(parsed).toEqual([{ state: "present", metadata: metadata(), summary: summary() }]);
    for (const value of [null, [], ["bad"], ["null"], [JSON.stringify({ state: "present", metadata: {} })]])
      expect(parseTerminalSessionProjections(value, 1)).toBeNull();
  });
});
