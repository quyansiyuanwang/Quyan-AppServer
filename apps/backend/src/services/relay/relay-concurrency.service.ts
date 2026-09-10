import { randomUUID } from "crypto";
import { LockBackendUnavailableError, TooManyRequestsError } from "@/util/errors";
import logger from "@/util/logger";
import { RedisService } from "@/services/infrastructure/redis.service";
import {
  GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID,
  GLOBAL_CONCURRENCY_STATUS_USER_ID,
} from "./utils/relay-concurrency.constants";
import type { RelayConcurrencyLease, RelayCapacityPolicy } from "./types/relay-proxy.types";

export type AcquireConcurrencyParams = RelayCapacityPolicy;

export interface GetConcurrencyStatusParams {
  userId?: string;
  limits: Record<string, unknown>;
}

export class RelayConcurrencyService {
  constructor(private readonly redis: RedisService = RedisService.getInstance()) {}

  static getConcurrencyKey(userId: string, scope: "default" | "image"): string {
    const resourceId = scope === "image" ? GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID : userId;
    return `relay:concurrency:${scope}:${resourceId}`;
  }

  async acquire(params: AcquireConcurrencyParams): Promise<RelayConcurrencyLease> {
    const { userId, scope, maxConcurrency, queueTimeout, enableQueue, slotTtlSeconds } = params;
    const baseKey = RelayConcurrencyService.getConcurrencyKey(userId, scope);
    const ownerToken = `${userId}:${randomUUID()}`;
    const ttlMs = slotTtlSeconds * 1000;
    if (!this.redis.isRedisAvailable())
      throw new LockBackendUnavailableError("Relay concurrency coordination backend unavailable");

    if (!enableQueue) {
      const slotKey = await this.redis.acquireSemaphoreSlot(baseKey, maxConcurrency, ownerToken, ttlMs);
      if (slotKey === null) throw new LockBackendUnavailableError("Relay concurrency coordination backend unavailable");
      if (slotKey === false) throw new TooManyRequestsError("Too many concurrent requests to upstream");
      return { key: baseKey, baseKey, slotKey, scope, source: "redis", ownerToken, ttlMs, ttlSeconds: slotTtlSeconds };
    }

    const waiterTtlMs = Math.max(queueTimeout + 1000, ttlMs);
    const ticket = await this.redis.reserveSemaphoreQueueTicket(baseKey, ownerToken, waiterTtlMs);
    if (ticket === null) throw new LockBackendUnavailableError("Relay concurrency coordination backend unavailable");
    const deadline = Date.now() + queueTimeout;
    const startWaitTime = Date.now();
    let waitLogged = false;
    while (true) {
      const slotKey = await this.redis.tryAcquireQueuedSemaphoreSlot(
        baseKey,
        maxConcurrency,
        ownerToken,
        ttlMs,
        ticket,
      );
      if (slotKey === null) {
        await this.redis.cancelSemaphoreQueueTicket(baseKey, ticket, ownerToken).catch(() => null);
        throw new LockBackendUnavailableError("Relay concurrency coordination backend unavailable");
      }
      if (slotKey !== "wait" && slotKey !== "stale") {
        const waitTime = Date.now() - startWaitTime;
        if (waitTime > 1000)
          logger.info("Concurrency slot acquired after waiting", {
            userId,
            scope,
            waitTimeMs: waitTime,
            waitTimeSec: `${(waitTime / 1000).toFixed(1)}s`,
            maxConcurrency,
          });
        return {
          key: baseKey,
          baseKey,
          slotKey,
          scope,
          source: "redis",
          ownerToken,
          ttlMs,
          ttlSeconds: slotTtlSeconds,
        };
      }
      if (slotKey === "stale") {
        await this.redis.cancelSemaphoreQueueTicket(baseKey, ticket, ownerToken).catch(() => null);
        throw new TooManyRequestsError("Request queue timeout waiting for upstream slot");
      }
      if (!waitLogged) {
        logger.info("Request queued - waiting for concurrency slot", {
          userId,
          scope,
          maxConcurrency,
          queueTimeoutMs: queueTimeout,
          baseKey,
          ticket,
        });
        waitLogged = true;
      }
      if (Date.now() >= deadline) {
        const waitTime = Date.now() - startWaitTime;
        await this.redis.cancelSemaphoreQueueTicket(baseKey, ticket, ownerToken).catch(() => null);
        logger.warn("Request queue timeout", {
          userId,
          scope,
          waitTimeMs: waitTime,
          waitTimeSec: `${(waitTime / 1000).toFixed(1)}s`,
          maxConcurrency,
          baseKey,
          ticket,
        });
        throw new TooManyRequestsError("Request queue timeout waiting for upstream slot");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async release(lease: RelayConcurrencyLease): Promise<void> {
    await this.redis.deleteIfValueMatches(lease.slotKey, lease.ownerToken);
  }

  startHeartbeat(lease: RelayConcurrencyLease): () => void {
    if (lease.ttlSeconds <= 1) return () => {};
    const intervalMs = Math.max(1000, Math.floor((lease.ttlSeconds * 1000) / 3));
    let stopped = false;
    let refreshInFlight = false;
    const timer = setInterval(() => {
      if (stopped || refreshInFlight) return;
      refreshInFlight = true;
      void this.redis
        .extendIfValueMatches(lease.slotKey, lease.ownerToken, lease.ttlMs)
        .catch((error) =>
          logger.warn("Failed to refresh relay concurrency lease", {
            key: lease.slotKey,
            baseKey: lease.baseKey,
            scope: lease.scope,
            error,
          }),
        )
        .finally(() => {
          refreshInFlight = false;
        });
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  async getStatus(params: GetConcurrencyStatusParams): Promise<any> {
    const { userId, limits } = params;
    const items: Array<{
      key: string;
      userId: string;
      scope: "default" | "image";
      source: "redis";
      activeCount: number;
      ttlSeconds: number | null;
      queueLength: number;
    }> = [];
    if (this.redis.isRedisAvailable()) {
      const patterns = userId
        ? {
            slots: [
              `relay:concurrency:default:${userId}:slot:*`,
              `relay:concurrency:image:${GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID}:slot:*`,
            ],
            waiters: [
              `relay:concurrency:default:${userId}:queue:waiter:*`,
              `relay:concurrency:image:${GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID}:queue:waiter:*`,
            ],
          }
        : {
            slots: [
              "relay:concurrency:default:*:slot:*",
              `relay:concurrency:image:${GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID}:slot:*`,
            ],
            waiters: [
              "relay:concurrency:default:*:queue:waiter:*",
              `relay:concurrency:image:${GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID}:queue:waiter:*`,
            ],
          };
      const aggregates = new Map<string, (typeof items)[number]>();
      const parse = (key: string) => {
        const match = key.match(
          /^(relay:concurrency:(default|image):(.+?))(?::(slot:\d+|queue:waiter:\d+|queue:tail|queue:serving))?$/,
        );
        if (!match) return null;
        const scope = match[2] as "default" | "image";
        const resourceId = match[3];
        return {
          baseKey: match[1],
          scope,
          userId:
            scope === "image" && resourceId === GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID
              ? GLOBAL_CONCURRENCY_STATUS_USER_ID
              : resourceId,
          kind: match[4]?.startsWith("slot:") ? "slot" : match[4]?.startsWith("queue:waiter:") ? "waiter" : "meta",
        } as const;
      };
      for (const keyPattern of patterns.slots)
        for (const key of await this.redis.getKeysByPattern(keyPattern, 500)) {
          const parsed = parse(key);
          if (!parsed || parsed.kind !== "slot") continue;
          const ttl = await this.redis.ttl(key);
          const entry = aggregates.get(parsed.baseKey) ?? {
            key: parsed.baseKey,
            userId: parsed.userId,
            scope: parsed.scope,
            source: "redis" as const,
            activeCount: 0,
            ttlSeconds: null,
            queueLength: 0,
          };
          entry.activeCount += 1;
          if (typeof ttl === "number" && ttl >= 0)
            entry.ttlSeconds = entry.ttlSeconds == null ? ttl : Math.min(entry.ttlSeconds, ttl);
          aggregates.set(parsed.baseKey, entry);
        }
      for (const keyPattern of patterns.waiters)
        for (const key of await this.redis.getKeysByPattern(keyPattern, 500)) {
          const parsed = parse(key);
          if (!parsed || parsed.kind !== "waiter") continue;
          const entry = aggregates.get(parsed.baseKey) ?? {
            key: parsed.baseKey,
            userId: parsed.userId,
            scope: parsed.scope,
            source: "redis" as const,
            activeCount: 0,
            ttlSeconds: null,
            queueLength: 0,
          };
          entry.queueLength += 1;
          aggregates.set(parsed.baseKey, entry);
        }
      items.push(...aggregates.values());
    }
    items.sort((a, b) => a.userId.localeCompare(b.userId) || a.scope.localeCompare(b.scope));
    const totals = items.reduce(
      (acc, item) => {
        acc.activeCount += item.activeCount;
        acc.queuedCount += item.queueLength;
        if (item.scope === "image") acc.imageScopeActiveCount += item.activeCount;
        else acc.defaultScopeActiveCount += item.activeCount;
        if (item.userId !== GLOBAL_CONCURRENCY_STATUS_USER_ID) acc.userIds.add(item.userId);
        return acc;
      },
      {
        activeCount: 0,
        defaultScopeActiveCount: 0,
        imageScopeActiveCount: 0,
        queuedCount: 0,
        userIds: new Set<string>(),
      },
    );
    return {
      redisAvailable: this.redis.isRedisAvailable(),
      userId,
      limits,
      totals: {
        activeCount: totals.activeCount,
        defaultScopeActiveCount: totals.defaultScopeActiveCount,
        imageScopeActiveCount: totals.imageScopeActiveCount,
        queuedCount: totals.queuedCount,
        userCount: totals.userIds.size,
      },
      items,
    };
  }
}
