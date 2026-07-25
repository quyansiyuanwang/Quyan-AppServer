import Redis from "ioredis";
import { createRedisClient } from "@/config/redis";
import { getLogger, LogCategory } from "@/util/logger";
import { EnvSpace } from "@/config/env";

const logger = getLogger("RedisService", LogCategory.REDIS);
const REDIS_SCAN_COUNT = 200;
const REDIS_SCAN_COUNT_MAX = 1000;
const REDIS_CIRCUIT_BREAKER_FAILURE_THRESHOLD = EnvSpace.redisConfig.circuitBreakerFailureThreshold;
const REDIS_CIRCUIT_BREAKER_OPEN_MS = EnvSpace.redisConfig.circuitBreakerOpenMs;

const resolveScanCount = (maxResults?: number): number => {
  if (typeof maxResults !== "number" || !Number.isFinite(maxResults) || maxResults <= 0) return REDIS_SCAN_COUNT;

  const expected = Math.floor(maxResults);
  return Math.min(REDIS_SCAN_COUNT_MAX, Math.max(REDIS_SCAN_COUNT, expected));
};

type CircuitState = "closed" | "open" | "half-open";

export class RedisService {
  private static instance: RedisService;
  private client: Redis | null = null;
  private isAvailable: boolean = false;
  private circuitState: CircuitState = "closed";
  private consecutiveFailures: number = 0;
  private circuitOpenedAt: number = 0;
  private halfOpenProbeInFlight: boolean = false;

  private constructor() {
    this.initialize();
  }

  public static getInstance(): RedisService {
    if (!RedisService.instance) RedisService.instance = new RedisService();

    return RedisService.instance;
  }

  private initialize(): void {
    try {
      this.client = createRedisClient();
      this.isAvailable = true;
    } catch (error) {
      logger.warn("Redis initialization failed, running without Redis:", error);
      this.isAvailable = false;
    }
  }

  private shouldShortCircuit(operationName: string): boolean {
    if (this.circuitState === "closed") return false;

    if (this.circuitState === "open") {
      const now = Date.now();
      if (now - this.circuitOpenedAt < REDIS_CIRCUIT_BREAKER_OPEN_MS) {
        logger.warn("Redis circuit open, operation skipped", {
          operation: operationName,
          state: this.circuitState,
          openMs: REDIS_CIRCUIT_BREAKER_OPEN_MS,
        });
        return true;
      }

      this.circuitState = "half-open";
      this.halfOpenProbeInFlight = false;
      logger.warn("Redis circuit entering half-open probe mode", {
        operation: operationName,
        state: this.circuitState,
      });
    }

    if (this.halfOpenProbeInFlight) {
      logger.warn("Redis circuit half-open probe already in flight, operation skipped", {
        operation: operationName,
        state: this.circuitState,
      });
      return true;
    }

    return false;
  }

  private onOperationSuccess(): void {
    const recovered = this.circuitState !== "closed" || this.consecutiveFailures > 0;

    this.circuitState = "closed";
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = 0;

    if (recovered) logger.info("Redis circuit closed after successful probe");
  }

  private onOperationFailure(operationName: string, error: unknown): void {
    this.consecutiveFailures += 1;

    const shouldOpen =
      this.circuitState === "half-open" || this.consecutiveFailures >= REDIS_CIRCUIT_BREAKER_FAILURE_THRESHOLD;

    if (shouldOpen) {
      this.circuitState = "open";
      this.circuitOpenedAt = Date.now();
      logger.error(`Redis circuit opened after ${operationName} failure`, {
        operation: operationName,
        consecutiveFailures: this.consecutiveFailures,
        threshold: REDIS_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
        openMs: REDIS_CIRCUIT_BREAKER_OPEN_MS,
        error,
      });
      return;
    }

    logger.error(`Redis ${operationName} error`, {
      operation: operationName,
      error,
      consecutiveFailures: this.consecutiveFailures,
    });
  }

  private async executeWithCircuit<T>(
    operationName: string,
    fallbackValue: T,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!this.isAvailable || !this.client) return fallbackValue;
    if (this.shouldShortCircuit(operationName)) return fallbackValue;

    const isHalfOpenProbe = this.circuitState === "half-open";
    if (isHalfOpenProbe) this.halfOpenProbeInFlight = true;

    try {
      const result = await operation();
      this.onOperationSuccess();
      return result;
    } catch (error) {
      this.onOperationFailure(operationName, error);
      return fallbackValue;
    } finally {
      if (isHalfOpenProbe) this.halfOpenProbeInFlight = false;
    }
  }

  /**
   * Increment a counter with optional TTL and weight
   * @param key Redis key
   * @param ttl Time to live in seconds (default: 3600)
   * @param weight Increment weight (default: 1, supports decimals like 0.3)
   * @returns New counter value or null if Redis unavailable
   */
  public async increment(key: string, ttl: number = 3600, weight: number = 1): Promise<number | null> {
    return this.executeWithCircuit("increment", null, async () => {
      const value = await this.client!.incrbyfloat(key, weight);
      const exists = await this.client!.ttl(key);

      // Set TTL if key has no expiry (skip if ttl=0, meaning persistent)
      if (exists === -1 && ttl > 0) await this.client!.expire(key, ttl);

      return parseFloat(value);
    });
  }

  /**
   * Try to increment a counter only when the new value does not exceed the configured limit.
   * Returns the new counter value when successful, -1 when the limit would be exceeded,
   * or null when Redis is unavailable.
   */
  public async tryIncrementWithinLimit(
    key: string,
    max: number,
    ttl: number = 3600,
    weight: number = 1,
  ): Promise<number | null> {
    return this.executeWithCircuit("tryIncrementWithinLimit", null, async () => {
      const script = `
        local current = tonumber(redis.call('get', KEYS[1]) or '0')
        local weight = tonumber(ARGV[1])
        local max = tonumber(ARGV[2])
        local ttl = tonumber(ARGV[3])

        if current + weight > max then
          return -1
        end

        local next = redis.call('incrbyfloat', KEYS[1], weight)
        local keyTtl = redis.call('ttl', KEYS[1])

        if keyTtl == -1 and ttl > 0 then
          redis.call('expire', KEYS[1], ttl)
        end

        return next
      `;

      const result = await this.client!.eval(script, 1, key, String(weight), String(max), String(ttl));
      return Number.parseFloat(String(result));
    });
  }

  /**
   * Refresh key TTL in seconds.
   * @returns true when TTL was refreshed, false when key is missing/ttl invalid, null when Redis is unavailable.
   */
  public async expire(key: string, ttl: number): Promise<boolean | null> {
    return this.executeWithCircuit("expire", null, async () => {
      if (!Number.isFinite(ttl) || ttl <= 0) return false;
      const result = await this.client!.expire(key, Math.floor(ttl));
      return result === 1;
    });
  }

  /**
   * Get a value from Redis
   * @param key Redis key
   * @returns Value as string or null
   */
  public async get(key: string): Promise<string | null> {
    return this.executeWithCircuit("get", null, async () => this.client!.get(key));
  }

  /**
   * Delete a key from Redis
   * @param key Redis key
   * @returns Number of keys deleted or null if Redis unavailable
   */
  public async delete(key: string): Promise<number | null> {
    return this.executeWithCircuit("delete", null, async () => this.client!.del(key));
  }

  /**
   * Check if a key exists in Redis
   * @param key Redis key
   * @returns True if exists, false otherwise
   */
  public async exists(key: string): Promise<boolean> {
    return this.executeWithCircuit("exists", false, async () => {
      const result = await this.client!.exists(key);
      return result === 1;
    });
  }

  /**
   * Get key remaining TTL in seconds.
   * -2 means key not exists, -1 means no expire.
   */
  public async ttl(key: string): Promise<number | null> {
    return this.executeWithCircuit("ttl", null, async () => this.client!.ttl(key));
  }

  /**
   * Generate IP error tracking key
   * @param ip IP address
   * @param hourTimestamp Hour timestamp (e.g., 2026021617)
   * @returns Redis key
   */
  public static getIpErrorKey(ip: string, hourTimestamp?: string): string {
    const timestamp = hourTimestamp || RedisService.getCurrentHourTimestamp();
    return `ip_errors:${ip}:${timestamp}`;
  }

  /**
   * Generate persistent IP error weight key
   * @param ip IP address
   * @returns Redis key
   */
  public static getIpErrorWeightKey(ip: string): string {
    return `ip_error_weight:${ip}`;
  }

  public static getIpErrorWeightTsKey(ip: string): string {
    return `ip_error_weight_ts:${ip}`;
  }

  public static getIpErrorBreakdownKey(ip: string): string {
    return `ip_error_breakdown:${ip}`;
  }

  /**
   * Increment a hash field by a float value
   * @param key Redis hash key
   * @param field Hash field
   * @param weight Increment amount
   */
  public async hIncrByFloat(key: string, field: string, weight: number): Promise<void> {
    await this.executeWithCircuit("hIncrByFloat", undefined, async () => {
      await this.client!.hincrbyfloat(key, field, weight);
      return undefined;
    });
  }

  /** Atomically increments multiple hash fields and refreshes the hash TTL. */
  public async hIncrByFloatFieldsWithTtl(
    key: string,
    fields: Record<string, number>,
    ttlSeconds: number,
  ): Promise<boolean | null> {
    const entries = Object.entries(fields).filter(([, value]) => Number.isFinite(value));
    if (entries.length === 0) return false;

    return this.executeWithCircuit("hIncrByFloatFieldsWithTtl", null, async () => {
      const script = `
        local ttl = tonumber(ARGV[1]) or 0
        for index = 2, #ARGV, 2 do
          redis.call('HINCRBYFLOAT', KEYS[1], ARGV[index], ARGV[index + 1])
        end
        if ttl > 0 then redis.call('EXPIRE', KEYS[1], ttl) end
        return 1
      `;
      const args = [String(Math.max(0, Math.floor(ttlSeconds)))];
      for (const [field, value] of entries) args.push(field, String(value));
      await this.client!.eval(script, 1, key, ...args);
      return true;
    });
  }

  /** Sets hash fields and refreshes the hash TTL in one Redis round trip. */
  public async hSetFieldsWithTtl(
    key: string,
    fields: Record<string, string | number>,
    ttlSeconds: number,
  ): Promise<boolean | null> {
    const entries = Object.entries(fields);
    if (entries.length === 0) return false;

    return this.executeWithCircuit("hSetFieldsWithTtl", null, async () => {
      const script = `
        local ttl = tonumber(ARGV[1]) or 0
        for index = 2, #ARGV, 2 do
          redis.call('HSET', KEYS[1], ARGV[index], ARGV[index + 1])
        end
        if ttl > 0 then redis.call('EXPIRE', KEYS[1], ttl) end
        return 1
      `;
      const args = [String(Math.max(0, Math.floor(ttlSeconds)))];
      for (const [field, value] of entries) args.push(field, String(value));
      await this.client!.eval(script, 1, key, ...args);
      return true;
    });
  }

  /**
   * Get all fields and values from a hash
   * @param key Redis hash key
   * @returns Record of field -> value strings, or null
   */
  public async hGetAll(key: string): Promise<Record<string, string> | null> {
    return this.executeWithCircuit("hGetAll", null, async () => {
      const result = await this.client!.hgetall(key);
      return result && Object.keys(result).length > 0 ? result : null;
    });
  }

  /** Reads multiple hashes in one Redis round trip. */
  public async hGetAllMany(keys: string[]): Promise<Record<string, Record<string, string>>> {
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    if (uniqueKeys.length === 0) return {};

    return this.executeWithCircuit("hGetAllMany", {}, async () => {
      const pipeline = this.client!.pipeline();
      for (const key of uniqueKeys) pipeline.hgetall(key);
      const results = await pipeline.exec();
      const output: Record<string, Record<string, string>> = {};
      for (let index = 0; index < uniqueKeys.length; index += 1) {
        const result = results?.[index]?.[1];
        if (result && typeof result === "object" && Object.keys(result).length > 0)
          output[uniqueKeys[index]] = result as Record<string, string>;
      }
      return output;
    });
  }

  /**
   * Get all IP error weight keys
   * @returns Array of IP addresses with error weights
   */
  public async getAllIpErrorWeightKeys(): Promise<string[]> {
    return this.getKeysByPattern("ip_error_weight:*");
  }

  /**
   * Get keys by pattern.
   * Use with care: this is intended for low-frequency maintenance/debug flows.
   */
  public async getKeysByPattern(pattern: string, maxResults?: number): Promise<string[]> {
    return this.executeWithCircuit("getKeysByPattern", [], async () => {
      let cursor = "0";
      const keys: string[] = [];
      const hasLimit = typeof maxResults === "number" && Number.isFinite(maxResults) && maxResults > 0;
      const normalizedLimit = hasLimit ? Math.floor(maxResults) : undefined;
      const scanCount = resolveScanCount(normalizedLimit);

      do {
        const [nextCursor, batch] = await this.client!.scan(cursor, "MATCH", pattern, "COUNT", String(scanCount));
        cursor = nextCursor;
        if (batch.length > 0) {
          if (normalizedLimit && keys.length + batch.length > normalizedLimit) {
            keys.push(...batch.slice(0, normalizedLimit - keys.length));
            break;
          }

          keys.push(...batch);
        }
      } while (cursor !== "0" && (!normalizedLimit || keys.length < normalizedLimit));

      return keys;
    });
  }

  /**
   * Delete a batch of keys.
   * @returns number of deleted keys (0 when input is empty), or null when redis is unavailable.
   */
  public async deleteMany(keys: string[]): Promise<number | null> {
    if (!this.isAvailable || !this.client) return null;
    if (!keys.length) return 0;

    return this.executeWithCircuit("deleteMany", null, async () => this.client!.del(...keys));
  }

  /**
   * Set a value in Redis with optional TTL
   * @param key Redis key
   * @param value Value to set
   * @param ttl Time to live in seconds (optional)
   */
  public async set(key: string, value: string | number, ttl?: number): Promise<void> {
    await this.executeWithCircuit("set", undefined, async () => {
      if (ttl) await this.client!.setex(key, ttl, value.toString());
      else await this.client!.set(key, value.toString());
      return undefined;
    });
  }

  /**
   * Set a value only when the key does not exist.
   * @returns true when set succeeds, false when key already exists, null when Redis is unavailable.
   */
  public async setIfNotExists(key: string, value: string | number, ttlMs?: number): Promise<boolean | null> {
    return this.executeWithCircuit("setIfNotExists", null, async () => {
      const normalizedValue = value.toString();

      if (ttlMs && ttlMs > 0) {
        const result = await this.client!.set(key, normalizedValue, "PX", Math.floor(ttlMs), "NX");
        return result === "OK";
      }

      const result = await this.client!.set(key, normalizedValue, "NX");
      return result === "OK";
    });
  }

  /**
   * Acquire the first available semaphore slot for a shared concurrency pool.
   * @returns The acquired slot key, false when all slots are occupied, or null when Redis is unavailable.
   */
  public async acquireSemaphoreSlot(
    baseKey: string,
    maxSlots: number,
    ownerToken: string,
    ttlMs: number,
  ): Promise<string | false | null> {
    return this.executeWithCircuit("acquireSemaphoreSlot", null, async () => {
      const script = `
        local slotPrefix = KEYS[1]
        local maxSlots = tonumber(ARGV[1])
        local ownerToken = ARGV[2]
        local ttlMs = tonumber(ARGV[3])

        for i = 1, maxSlots do
          local slotKey = slotPrefix .. i
          local acquired
          if ttlMs > 0 then
            acquired = redis.call('set', slotKey, ownerToken, 'PX', ttlMs, 'NX')
          else
            acquired = redis.call('set', slotKey, ownerToken, 'NX')
          end

          if acquired then
            return slotKey
          end
        end

        return ''
      `;

      const result = await this.client!.eval(
        script,
        1,
        `${baseKey}:slot:`,
        String(Math.max(1, Math.floor(maxSlots))),
        ownerToken,
        String(Math.max(0, Math.floor(ttlMs))),
      );

      const normalized = String(result || "");
      return normalized ? normalized : false;
    });
  }

  /**
   * Reserve a FIFO queue ticket for a semaphore-backed concurrency pool.
   * The queue waiter registration is expiring so abandoned waiters do not block the head forever.
   */
  public async reserveSemaphoreQueueTicket(baseKey: string, ownerToken: string, ttlMs: number): Promise<number | null> {
    return this.executeWithCircuit("reserveSemaphoreQueueTicket", null, async () => {
      const script = `
        local tailKey = KEYS[1]
        local servingKey = KEYS[2]
        local waiterPrefix = ARGV[1]
        local ownerToken = ARGV[2]
        local ttlMs = tonumber(ARGV[3])

        local ticket = redis.call('incr', tailKey)
        if redis.call('exists', servingKey) == 0 then
          redis.call('set', servingKey, 1)
        end

        local waiterKey = waiterPrefix .. ticket
        if ttlMs > 0 then
          redis.call('set', waiterKey, ownerToken, 'PX', ttlMs)
        else
          redis.call('set', waiterKey, ownerToken)
        end

        return ticket
      `;

      const result = await this.client!.eval(
        script,
        2,
        `${baseKey}:queue:tail`,
        `${baseKey}:queue:serving`,
        `${baseKey}:queue:waiter:`,
        ownerToken,
        String(Math.max(0, Math.floor(ttlMs))),
      );
      return Number.parseInt(String(result), 10);
    });
  }

  /**
   * Try to acquire a semaphore slot when the caller's queue ticket reaches the head of the FIFO queue.
   * @returns slot key when acquired, "wait" while still queued, "stale" when the ticket is obsolete, or null when Redis is unavailable.
   */
  public async tryAcquireQueuedSemaphoreSlot(
    baseKey: string,
    maxSlots: number,
    ownerToken: string,
    ttlMs: number,
    ticket: number,
  ): Promise<string | "wait" | "stale" | null> {
    return this.executeWithCircuit("tryAcquireQueuedSemaphoreSlot", null, async () => {
      const script = `
        local servingKey = KEYS[1]
        local slotPrefix = KEYS[2]
        local tailKey = KEYS[3]
        local ticket = tonumber(ARGV[1])
        local maxSlots = tonumber(ARGV[2])
        local ownerToken = ARGV[3]
        local ttlMs = tonumber(ARGV[4])
        local waiterPrefix = ARGV[5]

        local serving = tonumber(redis.call('get', servingKey) or '1')
        local tail = tonumber(redis.call('get', tailKey) or '0')

        while serving <= tail and redis.call('exists', waiterPrefix .. serving) == 0 do
          serving = serving + 1
        end
        redis.call('set', servingKey, serving)

        if ticket < serving then
          return 'STALE'
        end

        if ticket > serving or serving > tail then
          return 'WAIT'
        end

        for i = 1, maxSlots do
          local slotKey = slotPrefix .. i
          local acquired
          if ttlMs > 0 then
            acquired = redis.call('set', slotKey, ownerToken, 'PX', ttlMs, 'NX')
          else
            acquired = redis.call('set', slotKey, ownerToken, 'NX')
          end

          if acquired then
            redis.call('del', waiterPrefix .. ticket)
            local nextServing = ticket + 1
            while nextServing <= tail and redis.call('exists', waiterPrefix .. nextServing) == 0 do
              nextServing = nextServing + 1
            end
            redis.call('set', servingKey, nextServing)
            return slotKey
          end
        end

        return 'WAIT'
      `;

      const result = await this.client!.eval(
        script,
        3,
        `${baseKey}:queue:serving`,
        `${baseKey}:slot:`,
        `${baseKey}:queue:tail`,
        String(Math.max(1, Math.floor(ticket))),
        String(Math.max(1, Math.floor(maxSlots))),
        ownerToken,
        String(Math.max(0, Math.floor(ttlMs))),
        `${baseKey}:queue:waiter:`,
      );

      const normalized = String(result || "").toLowerCase();
      if (normalized === "wait") return "wait";
      if (normalized === "stale") return "stale";
      return normalized ? String(result) : "wait";
    });
  }

  /**
   * Cancel a reserved FIFO queue ticket so subsequent waiters can continue.
   */
  public async cancelSemaphoreQueueTicket(
    baseKey: string,
    ticket: number,
    ownerToken: string,
  ): Promise<boolean | null> {
    return this.executeWithCircuit("cancelSemaphoreQueueTicket", null, async () => {
      const script = `
        local servingKey = KEYS[1]
        local tailKey = KEYS[2]
        local waiterKey = KEYS[3]
        local waiterPrefix = ARGV[1]
        local ownerToken = ARGV[2]

        local serving = tonumber(redis.call('get', servingKey) or '1')
        local tail = tonumber(redis.call('get', tailKey) or '0')

        if redis.call('get', waiterKey) == ownerToken then
          redis.call('del', waiterKey)
        end

        while serving <= tail and redis.call('exists', waiterPrefix .. serving) == 0 do
          serving = serving + 1
        end
        redis.call('set', servingKey, serving)

        return 1
      `;

      const result = await this.client!.eval(
        script,
        3,
        `${baseKey}:queue:serving`,
        `${baseKey}:queue:tail`,
        `${baseKey}:queue:waiter:${Math.max(1, Math.floor(ticket))}`,
        `${baseKey}:queue:waiter:`,
        ownerToken,
      );

      return Number(result) === 1;
    });
  }

  /**
   * Delete a key only when the current value matches the expected owner token.
   * @returns true when deleted, false when key missing or token mismatch, null when Redis is unavailable.
   */
  public async deleteIfValueMatches(key: string, expectedValue: string): Promise<boolean | null> {
    return this.executeWithCircuit("deleteIfValueMatches", null, async () => {
      const script =
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
      const result = await this.client!.eval(script, 1, key, expectedValue);
      return Number(result) === 1;
    });
  }

  /** Atomically replace an owned value while preserving a bounded lease. */
  public async replaceIfValueMatches(
    key: string,
    expectedValue: string,
    nextValue: string,
    ttlMs: number,
  ): Promise<boolean | null> {
    return this.executeWithCircuit("replaceIfValueMatches", null, async () => {
      const script = `
        if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
        redis.call('set', KEYS[1], ARGV[2], 'PX', ARGV[3])
        return 1
      `;
      const result = await this.client!.eval(
        script,
        1,
        key,
        expectedValue,
        nextValue,
        String(Math.max(1, Math.floor(ttlMs))),
      );
      return Number(result) === 1;
    });
  }

  /**
   * Extend a key TTL only when the current value matches the expected owner token.
   * @returns true when TTL extended, false when key missing or token mismatch, null when Redis is unavailable.
   */
  public async extendIfValueMatches(key: string, expectedValue: string, ttlMs: number): Promise<boolean | null> {
    return this.executeWithCircuit("extendIfValueMatches", null, async () => {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false;

      const script =
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
      const result = await this.client!.eval(script, 1, key, expectedValue, String(Math.floor(ttlMs)));
      return Number(result) === 1;
    });
  }

  /**
   * Attempt to acquire a fair shared lock. A queued exclusive waiter blocks
   * later readers, so balance probes cannot be starved by relay traffic.
   *
   * Reader and writer leases are represented by expiring sorted-set members.
   * The Lua scripts remove expired members before every decision, which keeps
   * a crashed process from permanently blocking a channel.
   */
  public async tryAcquireFairReadLock(baseKey: string, ownerToken: string, ttlMs: number): Promise<boolean | null> {
    return this.executeWithCircuit("tryAcquireFairReadLock", null, async () => {
      const script = `
        local readersKey = KEYS[1]
        local writersKey = KEYS[2]
        local activeWriterKey = KEYS[3]
        local owner = ARGV[1]
        local now = tonumber(ARGV[2])
        local expiresAt = tonumber(ARGV[3])
        redis.call('zremrangebyscore', readersKey, '-inf', now)
        local queued = redis.call('zrange', writersKey, 0, -1)
        for _, writer in ipairs(queued) do
          if redis.call('exists', ARGV[4] .. writer) == 0 then redis.call('zrem', writersKey, writer) end
        end
        if redis.call('exists', activeWriterKey) == 1 or redis.call('zcard', writersKey) > 0 then return 0 end
        redis.call('zadd', readersKey, expiresAt, owner)
        redis.call('pexpire', readersKey, math.max(1, expiresAt - now + 1000))
        return 1
      `;
      const now = Date.now();
      const result = await this.client!.eval(
        script,
        3,
        `${baseKey}:readers`,
        `${baseKey}:writers`,
        `${baseKey}:writer`,
        ownerToken,
        String(now),
        String(now + Math.max(1, Math.floor(ttlMs))),
        `${baseKey}:writer-expiry:`,
      );
      return Number(result) === 1;
    });
  }

  /** Queue an exclusive lock request once. Queue score preserves writer FIFO order. */
  public async reserveFairWriteLock(baseKey: string, ownerToken: string, ttlMs: number): Promise<boolean | null> {
    return this.executeWithCircuit("reserveFairWriteLock", null, async () => {
      const script = `
        local writersKey = KEYS[1]
        local sequenceKey = KEYS[2]
        local owner = ARGV[1]
        local expiresAt = tonumber(ARGV[2])
        local now = tonumber(ARGV[3])
        redis.call('zremrangebyscore', writersKey, '-inf', now)
        if redis.call('zscore', writersKey, owner) then return 1 end
        local seq = redis.call('incr', sequenceKey)
        redis.call('zadd', writersKey, seq, owner)
        redis.call('pexpire', writersKey, math.max(1, expiresAt - now))
        redis.call('set', KEYS[3] .. owner, expiresAt, 'PX', math.max(1, expiresAt - now))
        return 1
      `;
      const now = Date.now();
      const expiresAt = now + Math.max(1, Math.floor(ttlMs));
      const result = await this.client!.eval(
        script,
        3,
        `${baseKey}:writers`,
        `${baseKey}:writer-sequence`,
        `${baseKey}:writer-expiry:`,
        ownerToken,
        String(expiresAt),
        String(now),
      );
      return Number(result) === 1;
    });
  }

  /** Try to promote the first queued writer when all readers have drained. */
  public async tryAcquireFairWriteLock(baseKey: string, ownerToken: string, ttlMs: number): Promise<"acquired" | "wait" | "stale" | null> {
    return this.executeWithCircuit("tryAcquireFairWriteLock", null, async () => {
      const script = `
        local readersKey = KEYS[1]
        local writersKey = KEYS[2]
        local activeWriterKey = KEYS[3]
        local owner = ARGV[1]
        local now = tonumber(ARGV[2])
        local ttlMs = tonumber(ARGV[3])
        redis.call('zremrangebyscore', readersKey, '-inf', now)
        local first = redis.call('zrange', writersKey, 0, 0)[1]
        while first and redis.call('exists', ARGV[4] .. first) == 0 do
          redis.call('zrem', writersKey, first)
          first = redis.call('zrange', writersKey, 0, 0)[1]
        end
        if not first or redis.call('zscore', writersKey, owner) == false then return 'STALE' end
        if first ~= owner or redis.call('exists', activeWriterKey) == 1 or redis.call('zcard', readersKey) > 0 then return 'WAIT' end
        redis.call('zrem', writersKey, owner)
        redis.call('set', activeWriterKey, owner, 'PX', ttlMs)
        return 'ACQUIRED'
      `;
      const result = await this.client!.eval(
        script,
        3,
        `${baseKey}:readers`,
        `${baseKey}:writers`,
        `${baseKey}:writer`,
        ownerToken,
        String(Date.now()),
        String(Math.max(1, Math.floor(ttlMs))),
        `${baseKey}:writer-expiry:`,
      );
      const normalized = String(result).toLowerCase();
      if (normalized === "acquired") return "acquired";
      if (normalized === "stale") return "stale";
      return "wait";
    });
  }

  public async releaseFairReadLock(baseKey: string, ownerToken: string): Promise<boolean | null> {
    return this.executeWithCircuit("releaseFairReadLock", null, async () => {
      const result = await this.client!.zrem(`${baseKey}:readers`, ownerToken);
      return Number(result) === 1;
    });
  }

  public async releaseFairWriteLock(baseKey: string, ownerToken: string): Promise<boolean | null> {
    return this.executeWithCircuit("releaseFairWriteLock", null, async () => {
      const script = `
        local activeWriterKey = KEYS[1]
        local writersKey = KEYS[2]
        local expiryKey = KEYS[3]
        local owner = ARGV[1]
        if redis.call('get', activeWriterKey) == owner then redis.call('del', activeWriterKey) end
        redis.call('zrem', writersKey, owner)
        redis.call('del', expiryKey)
        return 1
      `;
      const result = await this.client!.eval(
        script,
        3,
        `${baseKey}:writer`,
        `${baseKey}:writers`,
        `${baseKey}:writer-expiry:${ownerToken}`,
        ownerToken,
      );
      return Number(result) === 1;
    });
  }

  public async extendFairReadLock(baseKey: string, ownerToken: string, ttlMs: number): Promise<boolean | null> {
    return this.executeWithCircuit("extendFairReadLock", null, async () => {
      const now = Date.now();
      const score = await this.client!.zscore(`${baseKey}:readers`, ownerToken);
      if (score == null) return false;
      await this.client!.zadd(`${baseKey}:readers`, now + Math.max(1, Math.floor(ttlMs)), ownerToken);
      return true;
    });
  }

  /**
   * Decrement a value by a specific amount
   * @param key Redis key
   * @param amount Amount to decrement
   * @returns New value or null
   */
  public async decrement(key: string, amount: number = 1): Promise<number | null> {
    return this.executeWithCircuit("decrement", null, async () => {
      const value = await this.client!.incrbyfloat(key, -amount);
      return parseFloat(value);
    });
  }

  /**
   * Get current hour timestamp in format YYYYMMDDHH
   * @returns Hour timestamp string
   */
  public static getCurrentHourTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");
    return `${year}${month}${day}${hour}`;
  }

  /**
   * Check if Redis is available for optional operations.
   *
   * When the circuit breaker is open, callers should generally skip
   * best-effort Redis-dependent flows to avoid repeated request latency.
   */
  public isRedisAvailable(): boolean {
    return this.isAvailable && this.circuitState !== "open";
  }

  /**
   * Get current circuit breaker state
   */
  public getCircuitState(): string {
    return this.circuitState;
  }

  /**
   * Add JWT ID to blacklist
   * @param jti JWT ID
   * @param ttl Time to live in seconds (should match token expiry)
   */
  public async blacklistJti(jti: string, ttl: number): Promise<void> {
    await this.executeWithCircuit("blacklistJti", undefined, async () => {
      await this.client!.setex(`jti_blacklist:${jti}`, ttl, "1");
      return undefined;
    });
  }

  /**
   * Check if JWT ID is blacklisted
   * @param jti JWT ID
   * @returns True if blacklisted
   */
  public async isJtiBlacklisted(jti: string): Promise<boolean> {
    return this.executeWithCircuit("isJtiBlacklisted", false, async () => {
      const result = await this.client!.exists(`jti_blacklist:${jti}`);
      return result === 1;
    });
  }

  /**
   * Close Redis connection
   */
  public async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.isAvailable = false;
      this.circuitState = "closed";
      this.consecutiveFailures = 0;
      this.circuitOpenedAt = 0;
      this.halfOpenProbeInFlight = false;
    }
  }
}
