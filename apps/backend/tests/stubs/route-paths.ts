export const UNIT_TEST_ROUTE_STUB = true;

const routePaths: Record<string, string> = {
  V1SystemLogs: "/v1/system/logs",
  V1SystemServerLogFiles: "/v1/system/server-log-files",
  V1BusinessLogs: "/v1/business-logs",
  V1UsersMeHeartbeat: "/v1/users/me/heartbeat",
  V1TrackBatch: "/v1/track/batch",
  V1HeatmapCollect: "/v1/heatmap/collect",
  V1AuthRefresh: "/v1/auth/refresh",
  V1AuthReplaySigningSession: "/v1/auth/replay-signing-session",
  V1RemoteTerminalAgentHeartbeat: "/v1/remote-terminal/agent/heartbeat",
};

export const ApiRoutePath = new Proxy(routePaths, {
  get(target, property) {
    return typeof property === "string" ? (target[property] ?? `/__unit-route/${property}`) : undefined;
  },
}) as Record<string, string>;

export const ApiRoutePathPrefix = {
  RelayProxy: "/relay/proxy",
} as Record<string, string>;

export const ALL_API_ROUTE_PATHS = Object.values(routePaths);
export const ALL_API_ROUTE_PATH_PREFIXES = Object.values(ApiRoutePathPrefix);
export const API_ROUTE_OPERATION_IDS: Record<string, readonly string[]> = {};
export const API_ROUTE_PREFIX_MATCHES: Record<string, readonly string[]> = {};
