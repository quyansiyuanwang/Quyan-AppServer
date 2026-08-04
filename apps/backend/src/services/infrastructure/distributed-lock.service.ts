import { randomUUID } from "crypto";
import { env } from "@/config/env";
import { LockBackendUnavailableError, ResourceLockedError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import { RedisService } from "./redis.service";

const logger = getLogger("DistributedLockService", LogCategory.SECURITY);

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export interface DistributedLockHandle {
  key: string;
  ownerToken: string;
  acquiredAt: number;
  expiresAt: number;
  acquired: boolean;
}

export interface DistributedLockOptions {
  ttlMs?: number;
  acquireTimeoutMs?: number;
  retryIntervalMs?: number;
  failClosed?: boolean;
  ownerToken?: string;
}

interface NormalizedLockOptions {
  ttlMs: number;
  acquireTimeoutMs: number;
  retryIntervalMs: number;
  failClosed: boolean;
  ownerToken?: string;
}

export class DistributedLockService {
  private static instance: DistributedLockService;

  private constructor(private readonly redisService: RedisService = RedisService.getInstance()) {}

  public static getInstance(): DistributedLockService {
    if (!DistributedLockService.instance) DistributedLockService.instance = new DistributedLockService();

    return DistributedLockService.instance;
  }

  public static buildKey(scope: string, ...parts: Array<string | number>): string {
    const normalizedScope = scope.trim();
    const normalizedParts = parts
      .map((part) => String(part).trim())
      .filter((part) => part.length > 0)
      .map((part) => part.replace(/\s+/g, "_"));

    if (!normalizedScope) throw new Error("Distributed lock scope is required");

    return ["lock", normalizedScope, ...normalizedParts].join(":");
  }

  public async acquire(rawKey: string, options?: DistributedLockOptions): Promise<DistributedLockHandle> {
    const normalizedKey = this.normalizeKey(rawKey);
    const resolved = this.resolveOptions(options);

    if (!this.redisService.isRedisAvailable()) {
      if (resolved.failClosed) throw new LockBackendUnavailableError("Distributed lock backend is unavailable");

      const now = Date.now();

      return {
        key: normalizedKey,
        ownerToken: "",
        acquiredAt: now,
        expiresAt: now,
        acquired: false,
      };
    }

    const ownerToken = resolved.ownerToken || randomUUID();
    const startAt = Date.now();

    while (true) {
      const acquired = await this.redisService.setIfNotExists(normalizedKey, ownerToken, resolved.ttlMs);
      if (acquired === true) {
        const acquiredAt = Date.now();
        return {
          key: normalizedKey,
          ownerToken,
          acquiredAt,
          expiresAt: acquiredAt + resolved.ttlMs,
          acquired: true,
        };
      }

      if (acquired === null) {
        if (resolved.failClosed) throw new LockBackendUnavailableError("Distributed lock backend is unavailable");

        const now = Date.now();

        return {
          key: normalizedKey,
          ownerToken: "",
          acquiredAt: now,
          expiresAt: now,
          acquired: false,
        };
      }

      if (Date.now() - startAt >= resolved.acquireTimeoutMs)
        throw new ResourceLockedError(
          `Resource is locked: ${normalizedKey}`,
          Math.max(1, Math.ceil(resolved.retryIntervalMs / 1000)),
        );

      await sleep(resolved.retryIntervalMs);
    }
  }

  public async release(handle: DistributedLockHandle): Promise<boolean> {
    if (!handle.acquired) return true;

    const released = await this.redisService.deleteIfValueMatches(handle.key, handle.ownerToken);
    if (released === null) {
      logger.warn("Distributed lock release skipped because backend is unavailable", {
        key: handle.key,
      });
      return false;
    }

    return released;
  }

  public async extend(handle: DistributedLockHandle, ttlMs?: number): Promise<boolean> {
    if (!handle.acquired) return true;

    const extensionTtlMs = this.resolveTtlMs(ttlMs);
    const extended = await this.redisService.extendIfValueMatches(handle.key, handle.ownerToken, extensionTtlMs);
    if (extended === null) {
      logger.warn("Distributed lock extend skipped because backend is unavailable", {
        key: handle.key,
      });
      return false;
    }

    if (extended) handle.expiresAt = Date.now() + extensionTtlMs;

    return extended;
  }

  public async runWithLock<T>(key: string, task: () => Promise<T>, options?: DistributedLockOptions): Promise<T> {
    const lockHandle = await this.acquire(key, options);

    try {
      return await task();
    } finally {
      const released = await this.release(lockHandle);
      if (!released && lockHandle.acquired)
        logger.warn("Distributed lock may leak because release failed", {
          key: lockHandle.key,
        });
    }
  }

  private normalizeKey(rawKey: string): string {
    const normalized = String(rawKey || "").trim();
    if (!normalized) throw new Error("Distributed lock key is required");
    return normalized;
  }

  private resolveOptions(options?: DistributedLockOptions): NormalizedLockOptions {
    const config = env.integrations.distributedLock;

    return {
      ttlMs: this.resolveTtlMs(options?.ttlMs),
      acquireTimeoutMs: this.resolvePositiveInt(options?.acquireTimeoutMs, config.acquireTimeoutMs),
      retryIntervalMs: this.resolvePositiveInt(options?.retryIntervalMs, config.retryIntervalMs),
      failClosed: typeof options?.failClosed === "boolean" ? options.failClosed : config.failClosed,
      ownerToken: options?.ownerToken,
    };
  }

  private resolveTtlMs(ttlMs?: number): number {
    return this.resolvePositiveInt(ttlMs, env.integrations.distributedLock.defaultTtlMs);
  }

  private resolvePositiveInt(value: number | undefined, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
    return Math.floor(value);
  }
}
