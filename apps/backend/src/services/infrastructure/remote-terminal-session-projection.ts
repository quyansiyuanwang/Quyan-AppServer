import {
  REMOTE_TERMINAL_PROTOCOL_SHELL_TYPES,
  type RemoteTerminalSessionSummary,
} from "@/modules/remote-terminal/protocol";

export const TERMINAL_SESSION_STORAGE = Object.freeze({
  prefix: "remote_terminal:session",
  ttlSeconds: 3 * 24 * 60 * 60,
  projectionBatchSize: 500,
});
export function terminalSessionRedisKey(sessionId: string): string {
  if (!isTerminalSessionIdentifier(sessionId)) throw new Error("Invalid terminal session identifier");
  return TERMINAL_SESSION_STORAGE.prefix + ":" + sessionId;
}
export function isTerminalSessionIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export interface TerminalSessionMetadata {
  sessionId: string;
  ownerUserId: string;
  entitlementId: string;
  deviceId: string;
  status: RemoteTerminalSessionSummary["status"];
  revision: string;
}
export type TerminalSessionProjection =
  | { state: "missing" | "foreign" | "invalid" | "changed" }
  | { state: "present"; metadata: TerminalSessionMetadata; summary?: RemoteTerminalSessionSummary };

/** Executed inside Redis: full source documents and working directories never leave the server. */
export const TERMINAL_SESSION_PROJECTION_SCRIPT = `
local shells = cjson.decode(ARGV[2])
local function id(value)
  return type(value) == "string" and #value > 0 and #value <= 128 and not string.find(value, "[^%w_-]")
end
local function timestamp(value)
  if type(value) ~= "string" then return false end
  local y, m, d, h, minute, second = string.match(value, "^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)%.%d%d%dZ$")
  if not y then return false end
  y, m, d, h, minute, second = tonumber(y), tonumber(m), tonumber(d), tonumber(h), tonumber(minute), tonumber(second)
  if m < 1 or m > 12 or h > 23 or minute > 59 or second > 59 then return false end
  local days = {31,28,31,30,31,30,31,31,30,31,30,31}
  if y % 4 == 0 and (y % 100 ~= 0 or y % 400 == 0) then days[2] = 29 end
  return d >= 1 and d <= days[m]
end
local function project(key, expected)
  local raw = redis.call("GET", key)
  if not raw then return cjson.encode({state="missing"}) end
  local ok, source = pcall(cjson.decode, raw)
  if not ok or type(source) ~= "table" or not id(source.ownerUserId) then
    return cjson.encode({state="invalid"})
  end
  if source.ownerUserId ~= ARGV[1] then return cjson.encode({state="foreign"}) end
  local shellValid = false
  for _, shell in ipairs(shells) do if shell == source.shellType then shellValid = true end end
  if not id(source.sessionId) or not id(source.entitlementId) or not id(source.deviceId)
    or key ~= ARGV[3] .. ":" .. source.sessionId or source.mode ~= "shell" or not shellValid
    or (source.status ~= "pending" and source.status ~= "connected" and source.status ~= "closed")
    or not timestamp(source.createdAt) then
    return cjson.encode({state="invalid"})
  end
  local revision = "redis:" .. redis.sha1hex(raw)
  if expected ~= "" and revision ~= expected then return cjson.encode({state="changed"}) end
  local result = {state="present", metadata={sessionId=source.sessionId, ownerUserId=source.ownerUserId,
    entitlementId=source.entitlementId, deviceId=source.deviceId, status=source.status, revision=revision}}
  if expected ~= "" then
    result.summary = {sessionId=source.sessionId, deviceId=source.deviceId, mode=source.mode,
      shellType=source.shellType, status=source.status, createdAt=source.createdAt}
  end
  return cjson.encode(result)
end
local results = {}
for index, key in ipairs(KEYS) do results[index] = project(key, ARGV[index + 3]) end
return results
`;
export const terminalSessionProjectionShells = JSON.stringify(REMOTE_TERMINAL_PROTOCOL_SHELL_TYPES);

export function parseTerminalSessionProjections(value: unknown, count: number): TerminalSessionProjection[] | null {
  if (!Array.isArray(value) || value.length !== count) return null;
  const results: TerminalSessionProjection[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    let parsed: TerminalSessionProjection;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    if (["missing", "foreign", "invalid", "changed"].includes(parsed.state)) {
      results.push({ state: parsed.state } as TerminalSessionProjection);
      continue;
    }
    if (parsed.state !== "present") return null;
    const row = parsed.metadata,
      summary = parsed.summary;
    if (
      !row ||
      !isTerminalSessionIdentifier(row.sessionId) ||
      !isTerminalSessionIdentifier(row.ownerUserId) ||
      !isTerminalSessionIdentifier(row.entitlementId) ||
      !isTerminalSessionIdentifier(row.deviceId) ||
      !["pending", "connected", "closed"].includes(row.status) ||
      !/^redis:[a-f0-9]{40}$/.test(row.revision)
    )
      return null;
    // Copy only declared fields even when a malformed adapter returns extra properties.
    const safe: TerminalSessionProjection = {
      state: "present",
      metadata: {
        sessionId: row.sessionId,
        ownerUserId: row.ownerUserId,
        entitlementId: row.entitlementId,
        deviceId: row.deviceId,
        status: row.status,
        revision: row.revision,
      },
    };
    if (summary !== undefined) {
      if (
        !summary ||
        summary.sessionId !== row.sessionId ||
        summary.deviceId !== row.deviceId ||
        summary.status !== row.status ||
        summary.mode !== "shell" ||
        !REMOTE_TERMINAL_PROTOCOL_SHELL_TYPES.includes(summary.shellType) ||
        typeof summary.createdAt !== "string" ||
        !Number.isFinite(Date.parse(summary.createdAt)) ||
        new Date(summary.createdAt).toISOString() !== summary.createdAt
      )
        return null;
      safe.summary = {
        sessionId: summary.sessionId,
        deviceId: summary.deviceId,
        mode: summary.mode,
        shellType: summary.shellType,
        status: summary.status,
        createdAt: summary.createdAt,
      };
    }
    results.push(safe);
  }
  return results;
}

/** A pending session is replaced only if its exact authorized source is still current. */
export const TERMINAL_PENDING_SESSION_DELETE_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
if "redis:" .. redis.sha1hex(raw) ~= ARGV[4] then return 0 end
local ok, source = pcall(cjson.decode, raw)
if not ok or type(source) ~= "table" or source.ownerUserId ~= ARGV[1]
  or source.deviceId ~= ARGV[2] or source.sessionId ~= ARGV[3] or source.status ~= "pending" then return 0 end
return redis.call("DEL", KEYS[1])
`;
