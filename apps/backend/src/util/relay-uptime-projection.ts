import { createHash } from "node:crypto";
import { RELAY_UPTIME_POLICY } from "@/constant/relay-config";
import { isRelayUptimeMonitorId } from "@/iam/resources/platform-relay-uptime-resources";
import type { UptimeMonitor, UptimeResponse, HeartbeatItem } from "@/api/dto/relay/relay-config.dto";
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === "string";
export interface RelayUptimeMonitorTarget {
  id: string;
  categoryName: string;
  payload: Record<string, unknown>;
}
/** Derive identity metadata first; project full heartbeat data only for admitted monitors. */
export function relayUptimeTargets(response: unknown): RelayUptimeMonitorTarget[] {
  if (
    !object(response) ||
    !Array.isArray(response.data) ||
    typeof response.success !== "boolean" ||
    !text(response.message)
  )
    throw new Error("Invalid monitoring response");
  const targets: RelayUptimeMonitorTarget[] = [],
    ids = new Set<string>();
  for (const category of response.data) {
    if (!object(category) || !text(category.categoryName) || !Array.isArray(category.monitors))
      throw new Error("Invalid monitoring category");
    for (const monitor of category.monitors) {
      if (!object(monitor) || !text(monitor.name)) throw new Error("Invalid monitoring identity");
      const id =
        monitor.id === undefined
          ? "static_" +
            createHash("sha256")
              .update(JSON.stringify([category.categoryName, monitor.name]))
              .digest("hex")
          : monitor.id;
      if (!isRelayUptimeMonitorId(id) || ids.has(id)) throw new Error("Invalid or duplicate monitoring identity");
      ids.add(id);
      targets.push({ id, categoryName: category.categoryName, payload: monitor });
    }
  }
  return targets;
}
export function projectRelayUptimeMonitor(target: RelayUptimeMonitorTarget): UptimeMonitor {
  const row = target.payload;
  if (
    !text(row.name) ||
    !finite(row.uptime) ||
    !finite(row.status) ||
    !Number.isInteger(row.status) ||
    (row.group !== undefined && !text(row.group)) ||
    (row.heartbeats !== undefined && !Array.isArray(row.heartbeats))
  )
    throw new Error("Invalid monitoring payload");
  let heartbeats: HeartbeatItem[] | undefined;
  if (Array.isArray(row.heartbeats))
    heartbeats = row.heartbeats.slice(-RELAY_UPTIME_POLICY.heartbeatHistoryLimit).map((heartbeat) => {
      if (
        !object(heartbeat) ||
        !finite(heartbeat.status) ||
        !Number.isInteger(heartbeat.status) ||
        !text(heartbeat.time) ||
        !text(heartbeat.msg) ||
        (heartbeat.ping !== null && !finite(heartbeat.ping))
      )
        throw new Error("Invalid monitoring heartbeat");
      return { status: heartbeat.status, time: heartbeat.time, msg: heartbeat.msg, ping: heartbeat.ping };
    });
  return {
    id: target.id,
    name: row.name,
    uptime: row.uptime,
    status: row.status,
    ...(row.group !== undefined ? { group: row.group } : {}),
    ...(heartbeats ? { heartbeats } : {}),
  };
}
export function projectRelayUptimeResponse(
  response: UptimeResponse,
  targets: readonly RelayUptimeMonitorTarget[],
  admitted: ReadonlySet<string>,
): UptimeResponse {
  const categories = new Map<string, UptimeMonitor[]>();
  for (const target of targets)
    if (admitted.has(target.id)) {
      const monitors = categories.get(target.categoryName) ?? [];
      monitors.push(projectRelayUptimeMonitor(target));
      categories.set(target.categoryName, monitors);
    }
  return {
    data: [...categories].map(([categoryName, monitors]) => ({ categoryName, monitors })),
    message: response.message,
    success: response.success,
  };
}
