import { createHash } from "crypto";
import type { Request } from "express";
import { maskSensitiveData } from "@/util/mask-sensitive-data";
import { extractClientIp } from "@/util/ip-extractor";
import { getLogger, LogCategory } from "@/util/logger";
import { RedisService } from "@/services/infrastructure/redis.service";
import { ForbiddenError, TooManyRequestsError } from "@/util/errors";
import { env } from "@/config/env";
import { createCorsOriginAllowlist, isCorsOriginAllowed } from "@/util/cors-origin-matcher";
import {
  ObservabilityRepository,
  type CreateErrorOccurrenceInput,
  type ErrorGroupQuery,
} from "@/store/system/observability.repository";

const logger = getLogger("ErrorReportService", LogCategory.SYSTEM);
const CLIENT_REPORT_LIMIT = 30;
const CLIENT_REPORT_WINDOW_SECONDS = 60;
const MAX_TEXT_LENGTH = 8000;

export interface ErrorReportInput {
  source: "frontend" | "backend";
  errorType: string;
  message: string;
  route?: string;
  severity?: "error" | "fatal" | "warning";
  requestId?: string;
  httpMethod?: string;
  httpStatus?: number;
  clientVersion?: string;
  stack?: string;
  context?: unknown;
}

function limitText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.slice(0, maxLength);
}

function normalizeFingerprintText(value: string): string {
  return value
    .replace(/[A-Fa-f0-9]{8,}/g, "#")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function truncateContext(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limited]";
  if (typeof value === "string") return value.slice(0, 2000);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => truncateContext(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 50)
      .map(([key, item]) => [key, truncateContext(item, depth + 1)]),
  );
}

export class ErrorReportService {
  private static instance: ErrorReportService;

  private constructor(
    private readonly repository: ObservabilityRepository = ObservabilityRepository.getInstance(),
    private readonly redisService: RedisService = RedisService.getInstance(),
  ) {}

  public static getInstance(): ErrorReportService {
    if (!this.instance) this.instance = new ErrorReportService();
    return this.instance;
  }

  public async reportClientError(request: Request, input: ErrorReportInput): Promise<void> {
    await this.reportClientErrors(request, [input]);
  }

  public async reportClientErrors(request: Request, inputs: ErrorReportInput[]): Promise<void> {
    this.assertClientOrigin(request);
    const ipAddress = extractClientIp(request);
    await this.assertClientRateLimit(ipAddress, inputs.length);
    const requestContext = {
      userId: (request as Request & { user?: { userId?: string } }).user?.userId,
      userAgent: limitText(request.headers["user-agent"], 2000),
      ipAddress,
    };

    // Keep writes bounded and ordered to avoid a single browser batch causing
    // concurrent transaction spikes on smaller database instances.
    for (const input of inputs) await this.record(input, requestContext);
  }

  public async recordServerException(request: Request, error: Error): Promise<void> {
    await this.record(
      {
        source: "backend",
        errorType: error.name || "Error",
        message: error.message || "Unknown server error",
        route: request.path,
        severity: "fatal",
        requestId: limitText(request.headers["x-request-id"], 128),
        httpMethod: request.method,
        httpStatus: 500,
        stack: error.stack,
      },
      {
        userId: (request as Request & { user?: { userId?: string } }).user?.userId,
        userAgent: limitText(request.headers["user-agent"], 2000),
        ipAddress: extractClientIp(request),
      },
    );
  }

  public async record(
    input: ErrorReportInput,
    requestContext: Pick<CreateErrorOccurrenceInput, "userId" | "userAgent" | "ipAddress"> = {},
  ) {
    const safeMessage = limitText(input.message, 4000) || "Unknown error";
    const safeStack = limitText(input.stack);
    const safeContext = input.context ? truncateContext(maskSensitiveData(input.context)) : undefined;
    const stackSignature = safeStack?.split("\n").find((line) => /\bat\s/.test(line)) || "";
    const fingerprint = createHash("sha256")
      .update(
        [
          input.source,
          input.errorType,
          input.route || "",
          normalizeFingerprintText(safeMessage),
          normalizeFingerprintText(stackSignature),
        ].join("\n"),
      )
      .digest("hex");

    await this.repository.createErrorOccurrence({
      fingerprint,
      source: input.source,
      errorType: limitText(input.errorType, 120) || "Error",
      message: safeMessage,
      route: limitText(input.route, 1024),
      severity: input.severity || "error",
      requestId: limitText(input.requestId, 128),
      httpMethod: limitText(input.httpMethod, 12),
      httpStatus: input.httpStatus,
      clientVersion: limitText(input.clientVersion, 128),
      stack: safeStack,
      context: safeContext as any,
      ...requestContext,
    });
  }

  public getGroups(query: ErrorGroupQuery) {
    return this.repository.queryErrorGroups(query);
  }

  public getGroup(id: string) {
    return this.repository.getErrorGroup(id);
  }

  public updateGroupStatus(id: string, status: string) {
    return this.repository.updateErrorGroupStatus(id, status);
  }

  public getOccurrences(groupId: string, page: number, pageSize: number) {
    return this.repository.listErrorOccurrences(groupId, page, pageSize);
  }

  public async cleanupExpired(): Promise<number> {
    const cutoffAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    return this.repository.deleteErrorsBefore(cutoffAt);
  }

  private async assertClientRateLimit(ipAddress: string, weight = 1): Promise<void> {
    if (!this.redisService.isRedisAvailable()) return;
    const key = `error-report:client:${ipAddress}`;
    const count = Number((await this.redisService.get(key)) || "0");
    if (count + weight > CLIENT_REPORT_LIMIT)
      throw new TooManyRequestsError("Error report rate limit exceeded", CLIENT_REPORT_WINDOW_SECONDS);
    await this.redisService.increment(key, CLIENT_REPORT_WINDOW_SECONDS, weight);
  }

  private assertClientOrigin(request: Request): void {
    const origin = request.headers.origin;
    if (!origin || Array.isArray(origin)) return;

    // The CORS middleware is the source-of-truth for browser origins. An empty
    // allowlist intentionally permits local/dev origins, so do not turn the
    // optional FRONTEND_BASE_URL into an accidental production allowlist.
    const allowedOrigins = env.runtime.corsAllowedOrigins;
    const allowlist = createCorsOriginAllowlist(allowedOrigins);
    if (allowlist.length > 0 && !isCorsOriginAllowed(origin, allowlist))
      throw new ForbiddenError("Client error report origin is not allowed");
  }

  public reportServerExceptionSafely(request: Request, error: Error): void {
    void this.recordServerException(request, error).catch((reportError) =>
      logger.error("Failed to persist server error report", { reportError: String(reportError) }),
    );
  }
}
