import { JsonValue } from "@prisma/client/runtime/library";

export interface BuildInfoDTO {
  version: string;
  commitHash: string;
  commitHashShort: string;
  branch: string;
  commitMessage: string;
  commitTime: string;
  buildTime: string;
}

export interface MemoryUsageDTO {
  /** Resident Set Size (bytes) */
  rss: number;
  /** Total heap allocated (bytes) */
  heapTotal: number;
  /** Heap actually used (bytes) */
  heapUsed: number;
  /** C++ objects bound to JS (bytes) */
  external: number;
  /** ArrayBuffer + SharedArrayBuffer (bytes) */
  arrayBuffers: number;
  /** Heap usage percentage */
  heapUsagePercent: number;
}

export interface CpuUsageDTO {
  /** User CPU time (microseconds) */
  user: number;
  /** System CPU time (microseconds) */
  system: number;
}

export interface RuntimeInfoDTO {
  /** Node.js version */
  nodeVersion: string;
  /** V8 engine version */
  v8Version: string;
  /** OS platform */
  platform: string;
  /** CPU architecture */
  arch: string;
  /** Process ID */
  pid: number;
  /** Process title */
  processTitle: string;
  /** Current working directory */
  cwd: string;
  /** Number of CPU cores */
  cpuCores: number;
  /** CPU model */
  cpuModel: string;
  /** OS total memory (bytes) */
  osTotalMemory: number;
  /** OS free memory (bytes) */
  osFreeMemory: number;
  /** OS uptime (seconds) */
  osUptime: number;
  /** OS hostname */
  hostname: string;
}

export interface RedisStatusDTO {
  /** Whether Redis is available */
  available: boolean;
  /** Circuit breaker state */
  circuitState: string;
}

export interface ServerTimingDTO {
  /** Server start timestamp (epoch ms) */
  startedAt: number;
  /** Current server timestamp (epoch ms) */
  currentTime: number;
  /** Uptime duration (seconds) */
  uptimeSeconds: number;
  /** Human-readable uptime */
  uptimeFormatted: string;
}

export interface EnvironmentConfigDTO {
  /** NODE_ENV value */
  nodeEnv: string;
  /** Server port */
  port: number;
  /** Database URL (masked) */
  database: string;
  /** Redis host */
  redisHost: string;
  /** Redis port */
  redisPort: number;
  /** Redis DB index */
  redisDb: number;
  /** Captcha enabled */
  captchaEnabled: boolean;
  /** Active captcha provider */
  captchaProvider: string;
  /** Fallback captcha provider */
  captchaFallbackProvider: string;
  /** JWT access token expiry (seconds) */
  jwtAccessExpiresIn: string;
  /** JWT refresh token expiry (seconds) */
  jwtRefreshExpiresIn: string;
  /** CORS allowed origins */
  corsAllowedOrigins: string;
}

export interface SystemStatsDTO {
  // server timing
  server: ServerTimingDTO;
  buildInfo: BuildInfoDTO;

  // runtime
  runtime: RuntimeInfoDTO;
  memory: MemoryUsageDTO;
  cpu: CpuUsageDTO;

  // infrastructure
  redis: RedisStatusDTO;

  // application stats
  userCount: number;
  groupCount: number;
  permissionCount: number;

  // environment config (non-sensitive)
  config: EnvironmentConfigDTO;

  /** @deprecated Use server.startedAt instead */
  upTime: number;
}

export interface SystemLogServiceDTO {
  id: string;
  status: number;
  createTime: Date;
  updateTime: Date;
  requestID: string;
  userID: string | null;
  username: string | null;
  path: string;
  method: string;
  queryParams: JsonValue;
  bodyParams: JsonValue;
  ipAddress: string;
  statusCode: number;
  requestSizeBytes: number | null;
  requestSizeFormatted: string | null;
  responseSizeBytes: number | null;
  responseSizeFormatted: string | null;
}

export interface SystemLogDTO {
  logs: SystemLogServiceDTO[];
  total: number;
}

export interface SystemLogDetailDTO {
  id: string;
  status: number;
  createTime: Date;
  updateTime: Date;
  requestID: string;
  userID: string | null;
  username: string | null;
  path: string;
  method: string;
  queryParams: JsonValue;
  bodyParams: JsonValue;
  requestHeaders: JsonValue;
  responseHeaders: JsonValue;
  ipAddress: string;
  response: JsonValue;
  statusCode: number;
  requestSizeBytes: number | null;
  requestSizeFormatted: string | null;
  requestSizeSource: string | null;
  responseSizeBytes: number | null;
  responseSizeFormatted: string | null;
}

export interface LogStatsRangeDTO {
  startDate: string;
  endDate: string;
  days: number;
}

export interface LogStatsBreakdownDTO {
  key: string;
  label: string;
  count: number;
  share: number;
}

export interface LogStatsDailyBreakdownDTO {
  date: string;
  key: string;
  label: string;
  count: number;
}

export interface SystemLogStatsSummaryDTO {
  totalRequests: number;
  successRequests: number;
  redirectRequests: number;
  clientErrorRequests: number;
  serverErrorRequests: number;
  uniqueUsers: number;
  anonymousRequests: number;
  uniqueIPs: number;
}

export interface SystemLogStatsDailyDTO {
  date: string;
  totalRequests: number;
  successRequests: number;
  clientErrorRequests: number;
  serverErrorRequests: number;
}

export interface SystemLogStatsDTO {
  range: LogStatsRangeDTO;
  summary: SystemLogStatsSummaryDTO;
  daily: SystemLogStatsDailyDTO[];
  byMethod: LogStatsBreakdownDTO[];
  byStatusCode: LogStatsBreakdownDTO[];
  byPath: LogStatsBreakdownDTO[];
  methodDailyDistribution: LogStatsDailyBreakdownDTO[];
  statusDailyDistribution: LogStatsDailyBreakdownDTO[];
  generatedAt: string;
}

export type ServerLogType = "combined" | "error";

export interface ServerLogFileInfoDTO {
  name: string;
  type: ServerLogType;
  date: string;
  compressed: boolean;
  sizeBytes: number;
  modifiedTime: string;
}

export interface ServerLogFilesDTO {
  files: ServerLogFileInfoDTO[];
}

export interface ServerLogContentDTO {
  file: ServerLogFileInfoDTO;
  totalLineCount: number;
  matchedLineCount: number;
  returnedLines: number;
  truncated: boolean;
  search: string | null;
  content: string;
}

export interface ConsumptionStatsRangeDTO {
  startDate: string;
  endDate: string;
  days: number;
}

export interface ConsumptionStatsSummaryDTO {
  totalSpend: number;
  chargedSpend: number;
  coveredSpend: number;
  totalRequests: number;
  zeroChargeRequests: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  activeUsers: number;
  consumingUsers: number;
  avgSpendPerRequest: number;
  avgTokensPerRequest: number;
}

export interface ConsumptionStatsDailyDTO extends ConsumptionStatsSummaryDTO {
  date: string;
}

export interface ConsumptionStatsBreakdownDTO extends ConsumptionStatsSummaryDTO {
  key: string;
  label: string;
  share: number;
}

export interface ConsumptionStatsDailyBreakdownDTO extends ConsumptionStatsSummaryDTO {
  date: string;
  key: string;
  label: string;
}

export interface ConsumptionStatsFilterOptionDTO {
  key: string;
  label: string;
}

export interface ConsumptionStatsFilterOptionsDTO {
  users: ConsumptionStatsFilterOptionDTO[];
  models: ConsumptionStatsFilterOptionDTO[];
  channels: ConsumptionStatsFilterOptionDTO[];
  relayTokens: ConsumptionStatsFilterOptionDTO[];
}

export interface ConsumptionStatsDTO {
  range: ConsumptionStatsRangeDTO;
  filterOptions: ConsumptionStatsFilterOptionsDTO;
  summary: ConsumptionStatsSummaryDTO;
  daily: ConsumptionStatsDailyDTO[];
  byUser: ConsumptionStatsBreakdownDTO[];
  byChannel: ConsumptionStatsBreakdownDTO[];
  byModel: ConsumptionStatsBreakdownDTO[];
  userDailyDistribution: ConsumptionStatsDailyBreakdownDTO[];
  channelDailyDistribution: ConsumptionStatsDailyBreakdownDTO[];
  modelDailyDistribution: ConsumptionStatsDailyBreakdownDTO[];
  generatedAt: string;
}
