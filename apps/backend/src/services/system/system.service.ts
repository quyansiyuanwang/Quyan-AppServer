import os from "os";
import path from "path";
import fs from "fs-extra";
import { createInterface } from "readline";
import { createGunzip } from "zlib";
import type { JsonValue } from "@prisma/client/runtime/library";
import type {
  ConsumptionStatsBreakdownDTO,
  ConsumptionStatsDTO,
  ConsumptionStatsFilterOptionDTO,
  ConsumptionStatsFilterOptionsDTO,
  ConsumptionStatsDailyBreakdownDTO,
  ConsumptionStatsDailyDTO,
  ConsumptionStatsSummaryDTO,
  ServerLogContentDTO,
  ServerLogFileInfoDTO,
  ServerLogFilesDTO,
  ServerLogType,
  SystemLogDTO,
  SystemLogDetailDTO,
  SystemLogStatsDTO,
  SystemStatsDTO,
} from "@/api/dto/system/system.dto";
import { ALL_PERMISSIONS } from "@/constant/permission";
import { ConsumptionStatsRepository } from "@/store/system/consumption-stats.repository";
import { APILogRepository } from "@/store/system/apilog";
import { UserRepository } from "@/store/users/user.repository";
import { GroupRepository } from "@/store/users/group.repository";
import type {
  ConsumptionStatsFilters,
  ConsumptionStatsStore,
  ConsumptionUsageRow,
} from "@/store/system/consumption-stats.store";
import type { APILogStore } from "@/store/system/apilog.store";
import type { UserStore } from "@/store/users/user.store";
import type { GroupStore } from "@/store/users/group.store";
import { BUILD_INFO } from "@/generated/buildInfo";
import { RedisService } from "@/services/infrastructure/redis.service";
import { ConfigService } from "@/services/system/config.service";
import { EnvSpace } from "@/config/env";
import { INTERNAL_LOG_METADATA_KEY } from "@/config/logging";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function roundCountShare(count: number, total: number): number {
  return total > 0 ? round2((count / total) * 100) : 0;
}

interface SystemLogStatsSummaryAccumulator {
  totalRequests: number;
  successRequests: number;
  redirectRequests: number;
  clientErrorRequests: number;
  serverErrorRequests: number;
  uniqueUsers: Set<string>;
  uniqueIPs: Set<string>;
  anonymousRequests: number;
}

interface SystemLogStatsDailyAccumulator {
  date: string;
  totalRequests: number;
  successRequests: number;
  clientErrorRequests: number;
  serverErrorRequests: number;
}

function createSystemLogStatsSummaryAccumulator(): SystemLogStatsSummaryAccumulator {
  return {
    totalRequests: 0,
    successRequests: 0,
    redirectRequests: 0,
    clientErrorRequests: 0,
    serverErrorRequests: 0,
    uniqueUsers: new Set<string>(),
    uniqueIPs: new Set<string>(),
    anonymousRequests: 0,
  };
}

function applySystemLogStats(
  acc: SystemLogStatsSummaryAccumulator | SystemLogStatsDailyAccumulator,
  statusCode: number,
): void {
  acc.totalRequests += 1;
  if (statusCode >= 200 && statusCode < 300) acc.successRequests += 1;
  else if (statusCode >= 300 && statusCode < 400 && "redirectRequests" in acc) acc.redirectRequests += 1;
  else if (statusCode >= 400 && statusCode < 500) acc.clientErrorRequests += 1;
  else if (statusCode >= 500) acc.serverErrorRequests += 1;
}

function finalizeSystemLogStatsSummary(acc: SystemLogStatsSummaryAccumulator) {
  return {
    totalRequests: acc.totalRequests,
    successRequests: acc.successRequests,
    redirectRequests: acc.redirectRequests,
    clientErrorRequests: acc.clientErrorRequests,
    serverErrorRequests: acc.serverErrorRequests,
    uniqueUsers: acc.uniqueUsers.size,
    anonymousRequests: acc.anonymousRequests,
    uniqueIPs: acc.uniqueIPs.size,
  };
}

function normalizeTopPaths(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) return "unknown";

  const segments = trimmed.split("/").filter(Boolean);
  const normalizedSegments = segments.map((segment) =>
    /^[0-9]+$/.test(segment) || /^[a-z0-9]{16,}$/i.test(segment) ? ":id" : segment,
  );

  return `/${normalizedSegments.join("/")}`;
}

interface SummaryAccumulator {
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
  activeUserIds: Set<string>;
  consumingUserIds: Set<string>;
}

interface BreakdownAccumulator extends SummaryAccumulator {
  key: string;
  label: string;
}

interface DailyAccumulator extends SummaryAccumulator {
  date: string;
}

interface DailyBreakdownAccumulator extends BreakdownAccumulator {
  date: string;
}

function createSummaryAccumulator(): SummaryAccumulator {
  return {
    totalSpend: 0,
    chargedSpend: 0,
    coveredSpend: 0,
    totalRequests: 0,
    zeroChargeRequests: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    activeUserIds: new Set<string>(),
    consumingUserIds: new Set<string>(),
  };
}

function applyUsage(acc: SummaryAccumulator, row: ConsumptionUsageRow): void {
  acc.totalSpend = round4(acc.totalSpend + row.totalSpend);
  acc.chargedSpend = round4(acc.chargedSpend + row.chargedAmount);
  acc.coveredSpend = round4(acc.coveredSpend + row.coveredAmount);
  acc.totalRequests += 1;
  if (row.totalSpend <= 0) acc.zeroChargeRequests += 1;
  acc.totalTokens += row.totalTokens;
  acc.inputTokens += row.inputTokens;
  acc.outputTokens += row.outputTokens;
  acc.cacheCreationTokens += row.cacheCreationTokens;
  acc.cacheReadTokens += row.cacheReadTokens;
  acc.activeUserIds.add(row.userId);
  if (row.totalSpend > 0) acc.consumingUserIds.add(row.userId);
}

function finalizeSummary(acc: SummaryAccumulator): ConsumptionStatsSummaryDTO {
  return {
    totalSpend: round4(acc.totalSpend),
    chargedSpend: round4(acc.chargedSpend),
    coveredSpend: round4(acc.coveredSpend),
    totalRequests: acc.totalRequests,
    zeroChargeRequests: acc.zeroChargeRequests,
    totalTokens: acc.totalTokens,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    cacheCreationTokens: acc.cacheCreationTokens,
    cacheReadTokens: acc.cacheReadTokens,
    activeUsers: acc.activeUserIds.size,
    consumingUsers: acc.consumingUserIds.size,
    avgSpendPerRequest: acc.totalRequests > 0 ? round4(acc.totalSpend / acc.totalRequests) : 0,
    avgTokensPerRequest: acc.totalRequests > 0 ? round2(acc.totalTokens / acc.totalRequests) : 0,
  };
}

function sortBreakdown<T extends { totalSpend: number; totalRequests: number; label: string }>(items: T[]): T[] {
  return items.sort((a, b) => {
    if (b.totalSpend !== a.totalSpend) return b.totalSpend - a.totalSpend;
    if (b.totalRequests !== a.totalRequests) return b.totalRequests - a.totalRequests;
    return a.label.localeCompare(b.label);
  });
}

function sortFilterOptions(items: ConsumptionStatsFilterOptionDTO[]): ConsumptionStatsFilterOptionDTO[] {
  return items.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

const SERVER_LOG_FILE_PATTERN = /^(combined|error)-(\d{4}-\d{2}-\d{2})\.log(?:\.gz)?$/;

function parseHeaderContentLength(headers: unknown): number | null {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return null;

  const record = headers as Record<string, unknown>;
  const rawValue = record["content-length"];
  const headerValue = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const parsed =
    typeof headerValue === "number"
      ? headerValue
      : typeof headerValue === "string"
        ? Number.parseInt(headerValue, 10)
        : Number.NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function estimatePayloadSizeBytes(payload: unknown): number | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === "string") return Buffer.byteLength(payload);
  if (Buffer.isBuffer(payload)) return payload.length;
  if (payload instanceof Uint8Array) return payload.byteLength;

  try {
    return Buffer.byteLength(JSON.stringify(payload));
  } catch {
    return null;
  }
}

function formatByteSize(bytes: number | null): string | null {
  if (bytes === null || Number.isNaN(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function pushBoundedLine(lines: string[], line: string, limit: number): void {
  if (limit <= 0) return;
  if (lines.length >= limit) lines.shift();
  lines.push(line);
}

async function readServerLogTail(
  filePath: string,
  compressed: boolean,
  lineLimit: number,
  searchTerm: string,
): Promise<{
  totalLineCount: number;
  matchedLineCount: number;
  lines: string[];
}> {
  const fileStream = fs.createReadStream(filePath);
  const input = compressed ? fileStream.pipe(createGunzip()) : fileStream;
  const reader = createInterface({ input, crlfDelay: Infinity });

  let totalLineCount = 0;
  let matchedLineCount = 0;
  const lines: string[] = [];

  try {
    for await (const line of reader) {
      totalLineCount += 1;

      if (searchTerm.length > 0 && !line.toLowerCase().includes(searchTerm)) continue;

      matchedLineCount += 1;
      pushBoundedLine(lines, line, lineLimit);
    }
  } finally {
    reader.close();
  }

  return {
    totalLineCount,
    matchedLineCount,
    lines,
  };
}

function resolveRequestSizeInfo(log: { requestHeaders?: unknown; bodyParams?: unknown; method?: string }): {
  requestSizeBytes: number | null;
  requestSizeFormatted: string | null;
  requestSizeSource: string | null;
} {
  const headerSize = parseHeaderContentLength(log.requestHeaders);
  if (headerSize !== null)
    return {
      requestSizeBytes: headerSize,
      requestSizeFormatted: formatByteSize(headerSize),
      requestSizeSource: "content-length",
    };

  const estimatedBodySize = estimatePayloadSizeBytes(log.bodyParams);
  if (estimatedBodySize !== null)
    return {
      requestSizeBytes: estimatedBodySize,
      requestSizeFormatted: formatByteSize(estimatedBodySize),
      requestSizeSource: "body-estimate",
    };

  const normalizedMethod = (log.method || "").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(normalizedMethod))
    return {
      requestSizeBytes: 0,
      requestSizeFormatted: formatByteSize(0),
      requestSizeSource: "empty-body",
    };

  return {
    requestSizeBytes: null,
    requestSizeFormatted: null,
    requestSizeSource: null,
  };
}

function extractInternalLogMetadata(headers: unknown): Record<string, unknown> | null {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return null;

  const metadata = (headers as Record<string, unknown>)[INTERNAL_LOG_METADATA_KEY];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;

  return metadata as Record<string, unknown>;
}

function stripInternalLogMetadata(headers: unknown): JsonValue {
  if (headers === null) return null;
  if (typeof headers === "string" || typeof headers === "number" || typeof headers === "boolean") return headers;
  if (Array.isArray(headers)) return headers as JsonValue;
  if (typeof headers !== "object") return null;

  const { [INTERNAL_LOG_METADATA_KEY]: _internalMetadata, ...rest } = headers as Record<string, unknown>;
  return rest as JsonValue;
}

function extractResponseHeadersFromMetadata(log: { requestHeaders?: unknown }): JsonValue {
  const metadata = extractInternalLogMetadata(log.requestHeaders);
  const responseHeaders = metadata?.responseHeaders;

  if (responseHeaders === null) return null;
  if (
    typeof responseHeaders === "string" ||
    typeof responseHeaders === "number" ||
    typeof responseHeaders === "boolean"
  )
    return responseHeaders;
  if (Array.isArray(responseHeaders)) return responseHeaders as JsonValue;
  if (responseHeaders && typeof responseHeaders === "object") return responseHeaders as JsonValue;

  return null;
}

function resolveResponseHeaders(log: { responseHeaders?: unknown; requestHeaders?: unknown }): JsonValue {
  const responseHeaders = log.responseHeaders;

  if (responseHeaders === null) return extractResponseHeadersFromMetadata(log);
  if (
    typeof responseHeaders === "string" ||
    typeof responseHeaders === "number" ||
    typeof responseHeaders === "boolean"
  )
    return responseHeaders;
  if (Array.isArray(responseHeaders)) return responseHeaders as JsonValue;
  if (responseHeaders && typeof responseHeaders === "object") return responseHeaders as JsonValue;

  return extractResponseHeadersFromMetadata(log);
}

function resolveResponseSizeInfo(log: { requestHeaders?: unknown; response?: unknown }): {
  responseSizeBytes: number | null;
  responseSizeFormatted: string | null;
} {
  const metadata = extractInternalLogMetadata(log.requestHeaders);
  const metadataSize = metadata?.responseSizeBytes;
  const parsedMetadataSize = typeof metadataSize === "number" && metadataSize >= 0 ? metadataSize : null;

  if (parsedMetadataSize !== null)
    return {
      responseSizeBytes: parsedMetadataSize,
      responseSizeFormatted: formatByteSize(parsedMetadataSize),
    };

  const estimatedResponseSize = estimatePayloadSizeBytes(log.response);
  if (estimatedResponseSize !== null)
    return {
      responseSizeBytes: estimatedResponseSize,
      responseSizeFormatted: formatByteSize(estimatedResponseSize),
    };

  return {
    responseSizeBytes: null,
    responseSizeFormatted: null,
  };
}

export class SystemService {
  private static instance: SystemService | null = null;
  private startedAt: number;
  private readonly logsDir = path.join(EnvSpace.cwd, "logs");
  private readonly configService = ConfigService.getInstance();

  private constructor(
    private readonly apiLogRepository: APILogStore = APILogRepository.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly groupRepository: GroupStore = GroupRepository.getInstance(),
    private readonly consumptionStatsRepository: ConsumptionStatsStore = ConsumptionStatsRepository.getInstance(),
  ) {
    this.startedAt = Date.now();
  }

  static getInstance() {
    if (!this.instance) this.instance = new SystemService();

    return this.instance;
  }

  async getSystemStats(): Promise<SystemStatsDTO> {
    const userCount = await this.userRepository.countAll();
    const groupCount = await this.groupRepository.countAll();
    const permissionCount = ALL_PERMISSIONS.length;
    const captchaConfig = await this.configService.getCaptchaConfig();

    const now = Date.now();
    const uptimeSeconds = Math.floor((now - this.startedAt) / 1000);

    // Memory
    const mem = process.memoryUsage();

    // CPU
    const cpuUsage = process.cpuUsage();

    // OS / CPU info
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : "unknown";

    // Redis
    const redis = RedisService.getInstance();

    return {
      server: {
        startedAt: this.startedAt,
        currentTime: now,
        uptimeSeconds,
        uptimeFormatted: formatUptime(uptimeSeconds),
      },
      buildInfo: BUILD_INFO,

      runtime: {
        nodeVersion: process.version,
        v8Version: process.versions.v8,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        processTitle: process.title,
        cwd: process.cwd(),
        cpuCores: cpus.length,
        cpuModel,
        osTotalMemory: os.totalmem(),
        osFreeMemory: os.freemem(),
        osUptime: os.uptime(),
        hostname: os.hostname(),
      },

      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
        heapUsagePercent: mem.heapTotal > 0 ? Math.round((mem.heapUsed / mem.heapTotal) * 10000) / 100 : 0,
      },

      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },

      redis: {
        available: redis.isRedisAvailable(),
        circuitState: redis.getCircuitState(),
      },

      userCount,
      groupCount,
      permissionCount,

      config: {
        nodeEnv: process.env.NODE_ENV || "unknown",
        port: EnvSpace.port,
        database: EnvSpace.databaseParams,
        redisHost: EnvSpace.redisConfig.host || "localhost",
        redisPort: EnvSpace.redisConfig.port,
        redisDb: EnvSpace.redisConfig.db,
        captchaEnabled: captchaConfig.enabled,
        captchaProvider: captchaConfig.provider,
        captchaFallbackProvider: captchaConfig.fallbackProvider,
        jwtAccessExpiresIn: EnvSpace.accessTokenExpiresIn,
        jwtRefreshExpiresIn: EnvSpace.refreshTokenExpiresIn,
        corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS || "*",
      },

      // backward compatibility
      upTime: this.startedAt,
    };
  }

  async getLogs(
    page: number,
    pageSize: number,
    filters?: {
      user?: string;
      requestID?: string;
      path?: string;
      ip?: string;
      method?: string | string[];
      statusCode?: number | number[];
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<SystemLogDTO> {
    const result = await this.apiLogRepository.query({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      ...filters,
    });

    // Fetch usernames for logs with userID
    const userIDs = [...new Set(result.logs.filter((log) => log.userID).map((log) => log.userID!))];

    const usernameMap = new Map<string, string>();
    if (userIDs.length > 0) {
      const users = await this.userRepository.findUsernamesByIds(userIDs);
      users.forEach((user) => usernameMap.set(user.id, user.username));
    }

    // Attach username to each log
    const logsWithUsername = result.logs.map((log) => {
      const { requestHeaders: _requestHeaders, ...rest } = log;

      return {
        ...rest,
        username: log.userID ? usernameMap.get(log.userID) || null : null,
        ...resolveRequestSizeInfo(log),
        ...resolveResponseSizeInfo(log),
      };
    });

    return {
      logs: logsWithUsername,
      total: result.total,
    };
  }

  async getLogDetail(id: string): Promise<SystemLogDetailDTO | null> {
    const log = await this.apiLogRepository.findById(id);
    if (!log) return null;

    let username: string | null = null;
    if (log.userID) username = await this.userRepository.findActiveUsernameById(log.userID);

    return {
      ...log,
      username,
      requestHeaders: stripInternalLogMetadata(log.requestHeaders),
      responseHeaders: resolveResponseHeaders(log),
      ...resolveRequestSizeInfo(log),
      ...resolveResponseSizeInfo(log),
    };
  }

  async getLogStats(filters?: {
    user?: string;
    requestID?: string;
    path?: string;
    ip?: string;
    method?: string | string[];
    statusCode?: number | number[];
    startDate?: Date;
    endDate?: Date;
    search?: string;
  }): Promise<SystemLogStatsDTO> {
    const rows = await this.apiLogRepository.listForStats({
      ...filters,
    });

    const summaryAcc = createSystemLogStatsSummaryAccumulator();
    const dailyMap = new Map<string, SystemLogStatsDailyAccumulator>();
    const methodMap = new Map<string, number>();
    const statusMap = new Map<string, number>();
    const pathMap = new Map<string, number>();
    const methodDailyMap = new Map<string, { date: string; key: string; label: string; count: number }>();
    const statusDailyMap = new Map<string, { date: string; key: string; label: string; count: number }>();

    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    for (const row of rows) {
      const createTime = new Date(row.createTime);
      const dateKey = formatDateKey(createTime);
      const methodKey = row.method || "UNKNOWN";
      const statusKey = String(row.statusCode);
      const pathKey = normalizeTopPaths(row.path);

      applySystemLogStats(summaryAcc, row.statusCode);
      if (row.userID) summaryAcc.uniqueUsers.add(row.userID);
      else summaryAcc.anonymousRequests += 1;
      if (row.ipAddress) summaryAcc.uniqueIPs.add(row.ipAddress);

      const daily = dailyMap.get(dateKey) || {
        date: dateKey,
        totalRequests: 0,
        successRequests: 0,
        clientErrorRequests: 0,
        serverErrorRequests: 0,
      };
      applySystemLogStats(daily, row.statusCode);
      dailyMap.set(dateKey, daily);

      methodMap.set(methodKey, (methodMap.get(methodKey) || 0) + 1);
      statusMap.set(statusKey, (statusMap.get(statusKey) || 0) + 1);
      pathMap.set(pathKey, (pathMap.get(pathKey) || 0) + 1);

      const methodDailyComposite = `${dateKey}::${methodKey}`;
      const methodDaily = methodDailyMap.get(methodDailyComposite) || {
        date: dateKey,
        key: methodKey,
        label: methodKey,
        count: 0,
      };
      methodDaily.count += 1;
      methodDailyMap.set(methodDailyComposite, methodDaily);

      const statusDailyComposite = `${dateKey}::${statusKey}`;
      const statusDaily = statusDailyMap.get(statusDailyComposite) || {
        date: dateKey,
        key: statusKey,
        label: statusKey,
        count: 0,
      };
      statusDaily.count += 1;
      statusDailyMap.set(statusDailyComposite, statusDaily);

      if (!minDate || createTime < minDate) minDate = createTime;
      if (!maxDate || createTime > maxDate) maxDate = createTime;
    }

    const summary = finalizeSystemLogStatsSummary(summaryAcc);
    const totalRequests = summary.totalRequests;

    const finalizeBreakdown = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([key, count]) => ({
          key,
          label: key,
          count,
          share: roundCountShare(count, totalRequests),
        }))
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return a.label.localeCompare(b.label);
        });

    const resolvedStart = filters?.startDate
      ? startOfDay(filters.startDate)
      : minDate
        ? startOfDay(minDate)
        : startOfDay(new Date());
    const resolvedEnd = filters?.endDate
      ? endOfDay(filters.endDate)
      : maxDate
        ? endOfDay(maxDate)
        : endOfDay(new Date());

    return {
      range: {
        startDate: resolvedStart.toISOString(),
        endDate: resolvedEnd.toISOString(),
        days: Math.max(1, Math.floor((resolvedEnd.getTime() - resolvedStart.getTime()) / (24 * 60 * 60 * 1000)) + 1),
      },
      summary,
      daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
      byMethod: finalizeBreakdown(methodMap),
      byStatusCode: finalizeBreakdown(statusMap),
      byPath: finalizeBreakdown(pathMap).slice(0, 12),
      methodDailyDistribution: [...methodDailyMap.values()].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      }),
      statusDailyDistribution: [...statusDailyMap.values()].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  async getServerLogFiles(type?: ServerLogType): Promise<ServerLogFilesDTO> {
    const files = await this.listServerLogFiles(type);
    return { files };
  }

  async getServerLogContent(
    fileName: string,
    lines: number = 200,
    search?: string,
  ): Promise<ServerLogContentDTO | null> {
    const file = await this.findServerLogFile(fileName);
    if (!file) return null;

    const filePath = path.join(this.logsDir, file.name);
    if (!(await fs.pathExists(filePath))) return null;

    const searchable = (search || "").trim().toLowerCase();
    const lineLimit = Math.max(1, Math.min(lines, 2000));
    const result = await readServerLogTail(filePath, file.compressed, lineLimit, searchable);

    return {
      file,
      totalLineCount: result.totalLineCount,
      matchedLineCount: result.matchedLineCount,
      returnedLines: result.lines.length,
      truncated: result.matchedLineCount > result.lines.length,
      search: searchable.length > 0 ? search!.trim() : null,
      content: result.lines.join("\n"),
    };
  }

  private async listServerLogFiles(type?: ServerLogType): Promise<ServerLogFileInfoDTO[]> {
    if (!(await fs.pathExists(this.logsDir))) return [];

    const fileNames = await fs.readdir(this.logsDir);
    const matchedFiles = fileNames.filter((fileName) => {
      const match = SERVER_LOG_FILE_PATTERN.exec(fileName);
      if (!match) return false;
      return type ? match[1] === type : true;
    });

    const files = await Promise.all(matchedFiles.map((fileName) => this.buildServerLogFileInfo(fileName)));

    return files
      .filter((file): file is ServerLogFileInfoDTO => Boolean(file))
      .sort((a, b) => {
        const modifiedDiff = new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime();
        if (modifiedDiff !== 0) return modifiedDiff;
        return b.name.localeCompare(a.name);
      });
  }

  private async findServerLogFile(fileName: string): Promise<ServerLogFileInfoDTO | null> {
    const baseName = path.basename(fileName);
    if (!SERVER_LOG_FILE_PATTERN.test(baseName)) return null;

    return this.buildServerLogFileInfo(baseName);
  }

  private async buildServerLogFileInfo(fileName: string): Promise<ServerLogFileInfoDTO | null> {
    const match = SERVER_LOG_FILE_PATTERN.exec(fileName);
    if (!match) return null;

    const filePath = path.join(this.logsDir, fileName);
    if (!(await fs.pathExists(filePath))) return null;

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;

    return {
      name: fileName,
      type: match[1] as ServerLogType,
      date: match[2],
      compressed: fileName.endsWith(".gz"),
      sizeBytes: stat.size,
      modifiedTime: stat.mtime.toISOString(),
    };
  }

  async getConsumptionStats(filters?: {
    startDate?: Date;
    endDate?: Date;
    userIds?: string[];
    models?: string[];
    channels?: string[];
    relayTokenIds?: string[];
  }): Promise<ConsumptionStatsDTO> {
    const range = this.resolveConsumptionDateRange(filters?.startDate, filters?.endDate);
    const baseRows = await this.consumptionStatsRepository.listUsageRows(range.startDate, range.endDate);
    const filterOptions = this.buildConsumptionFilterOptions(baseRows);
    const rows = this.filterConsumptionRows(baseRows, filters);

    const summaryAcc = createSummaryAccumulator();
    const dailyMap = new Map<string, DailyAccumulator>();
    const userMap = new Map<string, BreakdownAccumulator>();
    const channelMap = new Map<string, BreakdownAccumulator>();
    const modelMap = new Map<string, BreakdownAccumulator>();
    const userDailyMap = new Map<string, DailyBreakdownAccumulator>();
    const channelDailyMap = new Map<string, DailyBreakdownAccumulator>();
    const modelDailyMap = new Map<string, DailyBreakdownAccumulator>();

    for (const row of rows) {
      applyUsage(summaryAcc, row);

      const date = formatDateKey(row.createTime);
      const userLabel = row.username || row.userId;
      const channelLabel = row.channelName || "unknown";
      const modelLabel = row.model || "unknown";

      const daily = dailyMap.get(date) || { date, ...createSummaryAccumulator() };
      applyUsage(daily, row);
      dailyMap.set(date, daily);

      this.applyBreakdownRow(userMap, row.userId, userLabel, row);
      this.applyBreakdownRow(channelMap, channelLabel, channelLabel, row);
      this.applyBreakdownRow(modelMap, modelLabel, modelLabel, row);
      this.applyDailyBreakdownRow(userDailyMap, `${date}::${row.userId}`, date, row.userId, userLabel, row);
      this.applyDailyBreakdownRow(channelDailyMap, `${date}::${channelLabel}`, date, channelLabel, channelLabel, row);
      this.applyDailyBreakdownRow(modelDailyMap, `${date}::${modelLabel}`, date, modelLabel, modelLabel, row);
    }

    const summary = finalizeSummary(summaryAcc);
    const daily = [...dailyMap.values()]
      .map((item) => ({ date: item.date, ...finalizeSummary(item) }))
      .sort((a, b) => a.date.localeCompare(b.date)) satisfies ConsumptionStatsDailyDTO[];

    const byUser = this.finalizeBreakdown(userMap, summary.totalSpend);
    const byChannel = this.finalizeBreakdown(channelMap, summary.totalSpend);
    const byModel = this.finalizeBreakdown(modelMap, summary.totalSpend);
    const userDailyDistribution = this.finalizeDailyBreakdown(userDailyMap);
    const channelDailyDistribution = this.finalizeDailyBreakdown(channelDailyMap);
    const modelDailyDistribution = this.finalizeDailyBreakdown(modelDailyMap);

    return {
      range: {
        startDate: range.startDate.toISOString(),
        endDate: range.endDate.toISOString(),
        days: range.days,
      },
      filterOptions,
      summary,
      daily,
      byUser,
      byChannel,
      byModel,
      userDailyDistribution,
      channelDailyDistribution,
      modelDailyDistribution,
      generatedAt: new Date().toISOString(),
    };
  }

  private buildConsumptionFilterOptions(rows: ConsumptionUsageRow[]): ConsumptionStatsFilterOptionsDTO {
    const userMap = new Map<string, ConsumptionStatsFilterOptionDTO>();
    const modelMap = new Map<string, ConsumptionStatsFilterOptionDTO>();
    const channelMap = new Map<string, ConsumptionStatsFilterOptionDTO>();
    const relayTokenMap = new Map<string, ConsumptionStatsFilterOptionDTO>();

    for (const row of rows) {
      userMap.set(row.userId, {
        key: row.userId,
        label: row.username || row.userId,
      });

      if (row.model)
        modelMap.set(row.model, {
          key: row.model,
          label: row.model,
        });

      if (row.channelName)
        channelMap.set(row.channelName, {
          key: row.channelName,
          label: row.channelName,
        });

      if (row.relayTokenId)
        relayTokenMap.set(row.relayTokenId, {
          key: row.relayTokenId,
          label: row.relayTokenName || row.relayTokenId,
        });
    }

    return {
      users: sortFilterOptions([...userMap.values()]),
      models: sortFilterOptions([...modelMap.values()]),
      channels: sortFilterOptions([...channelMap.values()]),
      relayTokens: sortFilterOptions([...relayTokenMap.values()]),
    };
  }

  private filterConsumptionRows(rows: ConsumptionUsageRow[], filters?: ConsumptionStatsFilters): ConsumptionUsageRow[] {
    const normalizedUserIds = this.normalizeConsumptionFilterValues(filters?.userIds);
    const normalizedModels = this.normalizeConsumptionFilterValues(filters?.models);
    const normalizedChannels = this.normalizeConsumptionFilterValues(filters?.channels);
    const normalizedRelayTokenIds = this.normalizeConsumptionFilterValues(filters?.relayTokenIds);

    if (!normalizedUserIds && !normalizedModels && !normalizedChannels && !normalizedRelayTokenIds) return rows;

    return rows.filter((row) => {
      if (normalizedUserIds && !normalizedUserIds.has(row.userId)) return false;
      if (!this.matchesConsumptionOptionalFilter(normalizedModels, row.model)) return false;
      if (!this.matchesConsumptionOptionalFilter(normalizedChannels, row.channelName)) return false;
      if (!this.matchesConsumptionOptionalFilter(normalizedRelayTokenIds, row.relayTokenId)) return false;

      return true;
    });
  }

  private matchesConsumptionOptionalFilter(
    filterValues: Set<string> | null,
    value: string | null | undefined,
  ): boolean {
    if (!filterValues) return true;

    const normalizedValue = value?.trim();
    if (!normalizedValue) return false;

    return filterValues.has(normalizedValue);
  }

  private normalizeConsumptionFilterValues(values?: string[]): Set<string> | null {
    if (!values?.length) return null;

    const normalized = [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
    return normalized.length > 0 ? new Set(normalized) : null;
  }

  private resolveConsumptionDateRange(
    startDate?: Date,
    endDate?: Date,
  ): {
    startDate: Date;
    endDate: Date;
    days: number;
  } {
    const resolvedEnd = endDate ? endOfDay(endDate) : endOfDay(new Date());
    const resolvedStart = startDate
      ? startOfDay(startDate)
      : startOfDay(new Date(resolvedEnd.getTime() - 6 * 24 * 60 * 60 * 1000));
    const days = Math.max(1, Math.floor((resolvedEnd.getTime() - resolvedStart.getTime()) / (24 * 60 * 60 * 1000)) + 1);

    return {
      startDate: resolvedStart,
      endDate: resolvedEnd,
      days,
    };
  }

  private applyBreakdownRow(
    target: Map<string, BreakdownAccumulator>,
    key: string,
    label: string,
    row: ConsumptionUsageRow,
  ): void {
    const existing = target.get(key) || { key, label, ...createSummaryAccumulator() };
    applyUsage(existing, row);
    target.set(key, existing);
  }

  private applyDailyBreakdownRow(
    target: Map<string, DailyBreakdownAccumulator>,
    compositeKey: string,
    date: string,
    key: string,
    label: string,
    row: ConsumptionUsageRow,
  ): void {
    const existing = target.get(compositeKey) || { date, key, label, ...createSummaryAccumulator() };
    applyUsage(existing, row);
    target.set(compositeKey, existing);
  }

  private finalizeBreakdown(
    map: Map<string, BreakdownAccumulator>,
    totalSpend: number,
  ): ConsumptionStatsBreakdownDTO[] {
    return sortBreakdown(
      [...map.values()].map((item) => ({
        key: item.key,
        label: item.label,
        ...finalizeSummary(item),
        share: totalSpend > 0 ? round2((item.totalSpend / totalSpend) * 100) : 0,
      })),
    );
  }

  private finalizeDailyBreakdown(map: Map<string, DailyBreakdownAccumulator>): ConsumptionStatsDailyBreakdownDTO[] {
    return [...map.values()]
      .map((item) => ({
        date: item.date,
        key: item.key,
        label: item.label,
        ...finalizeSummary(item),
      }))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (b.totalSpend !== a.totalSpend) return b.totalSpend - a.totalSpend;
        return a.label.localeCompare(b.label);
      });
  }
}
