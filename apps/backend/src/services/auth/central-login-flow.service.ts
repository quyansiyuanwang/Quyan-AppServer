import { randomUUID } from "crypto";
import { env } from "@/config/env";
import { RedisService } from "@/services/infrastructure/redis.service";
import { BadRequestError, ForbiddenError, InternalServerError, NotFoundError } from "@/util/errors";

const FLOW_KEY_PREFIX = "auth:central-login-flow:";

interface StoredCentralLoginFlow {
  returnTo: string;
  ownerUserId?: string;
}

export interface CentralLoginFlowContext {
  flowId: string;
}

export interface ConsumedCentralLoginFlow {
  returnTo: string;
}

const normalizeAllowedOrigin = (origin: string): string | undefined => {
  try {
    const parsed = new URL(origin);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
};

export class CentralLoginFlowService {
  private static instance: CentralLoginFlowService;
  private readonly allowedOrigins: ReadonlySet<string>;

  public constructor(
    private readonly redis: Pick<
      RedisService,
      "set" | "get" | "getAndDelete" | "isRedisAvailable"
    > = RedisService.getInstance(),
    allowedOrigins: readonly string[] = env.auth.centralLogin.allowedOrigins,
    private readonly flowTtlSeconds: number = env.auth.centralLogin.flowTtlSeconds,
  ) {
    this.allowedOrigins = new Set(
      allowedOrigins.map(normalizeAllowedOrigin).filter((origin): origin is string => Boolean(origin)),
    );
  }

  public static getInstance(): CentralLoginFlowService {
    if (!CentralLoginFlowService.instance) CentralLoginFlowService.instance = new CentralLoginFlowService();
    return CentralLoginFlowService.instance;
  }

  private buildKey(flowId: string): string {
    return `${FLOW_KEY_PREFIX}${flowId}`;
  }

  private ensureStorageAvailable(): void {
    if (!this.redis.isRedisAvailable()) throw new InternalServerError("Central login flow storage is unavailable");
  }

  private normalizeReturnTo(returnTo: string): string {
    let parsed: URL;
    try {
      parsed = new URL(returnTo);
    } catch {
      throw new BadRequestError("Invalid central login return URL");
    }

    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !this.allowedOrigins.has(parsed.origin))
      throw new BadRequestError("Central login return URL is not allowed");

    return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  public async createFlow(returnTo: string, ownerUserId?: string): Promise<CentralLoginFlowContext> {
    this.ensureStorageAvailable();
    const flowId = randomUUID();
    const stored: StoredCentralLoginFlow = {
      returnTo: this.normalizeReturnTo(returnTo),
      ...(ownerUserId ? { ownerUserId } : {}),
    };
    await this.redis.set(this.buildKey(flowId), JSON.stringify(stored), this.flowTtlSeconds);
    return { flowId };
  }

  public async getFlowContext(flowId: string): Promise<CentralLoginFlowContext> {
    this.ensureStorageAvailable();
    const raw = await this.redis.get(this.buildKey(flowId));
    if (!raw) throw new NotFoundError("Central login flow not found or expired");
    return { flowId };
  }

  public async consumeFlow(flowId: string, userId: string): Promise<ConsumedCentralLoginFlow> {
    this.ensureStorageAvailable();
    const raw = await this.redis.getAndDelete(this.buildKey(flowId));
    if (!raw) throw new NotFoundError("Central login flow not found or already consumed");

    let stored: StoredCentralLoginFlow;
    try {
      stored = JSON.parse(raw) as StoredCentralLoginFlow;
    } catch {
      throw new NotFoundError("Central login flow not found or expired");
    }

    if (typeof stored.returnTo !== "string") throw new NotFoundError("Central login flow not found or expired");
    if (stored.ownerUserId && stored.ownerUserId !== userId)
      throw new ForbiddenError("Central login flow belongs to another user");

    return { returnTo: this.normalizeReturnTo(stored.returnTo) };
  }
}
