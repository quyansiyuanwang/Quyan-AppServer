import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { RedisService } from "@/services/infrastructure/redis.service";
import { terminalSessionRedisKey } from "@/services/infrastructure/remote-terminal-session-projection";
const redis = RedisService.getInstance();
const keys: string[] = [];
const source = () => ({
  sessionId: randomUUID(),
  ownerUserId: "projection-fixture-owner",
  entitlementId: "fixture-entitlement",
  deviceId: "fixture-device",
  mode: "shell",
  shellType: "bash",
  status: "pending",
  createdAt: "2026-10-14T00:00:00.000Z",
  workingDirectory: "PRIVATE-WORKING-DIRECTORY",
  browserToken: "PRIVATE-CAPABILITY-FIXTURE",
});
async function store(value: ReturnType<typeof source>, raw = JSON.stringify(value)) {
  const key = terminalSessionRedisKey(value.sessionId);
  keys.push(key);
  expect(await redis.set(key, raw, 60)).not.toBeNull();
  return key;
}
afterEach(async () => {
  if (keys.length) await redis.deleteMany(keys.splice(0));
});
describe("terminal session server-side Redis projection", () => {
  it("returns metadata and admitted public summaries without private source fields", async () => {
    const row = source(),
      key = await store(row);
    const result = await redis.projectTerminalSessions(row.ownerUserId, [key]);
    expect(result).toHaveLength(1);
    const item = result![0];
    if (item.state !== "present") throw new Error("Expected fixture metadata");
    expect(item.summary).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    const hydrated = await redis.projectTerminalSessions(row.ownerUserId, [key], [item.metadata.revision]);
    expect(hydrated).toEqual([
      {
        state: "present",
        metadata: item.metadata,
        summary: {
          sessionId: row.sessionId,
          deviceId: row.deviceId,
          mode: row.mode,
          shellType: row.shellType,
          status: row.status,
          createdAt: row.createdAt,
        },
      },
    ]);
    expect(JSON.stringify(hydrated)).not.toContain("PRIVATE");
  });
  it("detects edits even if private source fields alone changed", async () => {
    const row = source(),
      key = await store(row),
      result = await redis.projectTerminalSessions(row.ownerUserId, [key]);
    const item = result![0];
    if (item.state !== "present") throw new Error("Expected fixture metadata");
    await redis.set(key, JSON.stringify({ ...row, workingDirectory: "CHANGED" }), 60);
    expect(await redis.projectTerminalSessions(row.ownerUserId, [key], [item.metadata.revision])).toEqual([
      { state: "changed" },
    ]);
  });
  it("distinguishes foreign, missing, and malformed records", async () => {
    const row = source(),
      key = await store(row),
      bad = await store(source(), "{");
    expect(await redis.projectTerminalSessions("other-owner", [key])).toEqual([{ state: "foreign" }]);
    expect(await redis.projectTerminalSessions(row.ownerUserId, [bad])).toEqual([{ state: "invalid" }]);
    expect(await redis.projectTerminalSessions(row.ownerUserId, [terminalSessionRedisKey(randomUUID())])).toEqual([
      { state: "missing" },
    ]);
  });
  it.each(["sessionId", "deviceId", "entitlementId", "status", "shellType", "mode", "createdAt"])(
    "rejects corrupt owned %s",
    async (field) => {
      const row = source(),
        key = await store(row, JSON.stringify({ ...row, [field]: "INVALID/CONTROL" }));
      expect(await redis.projectTerminalSessions(row.ownerUserId, [key])).toEqual([{ state: "invalid" }]);
    },
  );
  it.each(["2026-02-29T00:00:00.000Z", "2026-13-01T00:00:00.000Z", "2026-10-14T24:00:00.000Z"])(
    "rejects noncanonical calendar timestamp %s",
    async (createdAt) => {
      const row = source(),
        key = await store(row, JSON.stringify({ ...row, createdAt }));
      expect(await redis.projectTerminalSessions(row.ownerUserId, [key])).toEqual([{ state: "invalid" }]);
    },
  );
  it("rejects arbitrary keys and invalid requested revisions", async () => {
    expect(await redis.projectTerminalSessions("owner", ["unrelated:key"])).toBeNull();
    expect(
      await redis.projectTerminalSessions("owner", [terminalSessionRedisKey(randomUUID())], ["invalid"]),
    ).toBeNull();
  });
});
