import { randomUUID } from "crypto";
import { RedisService } from "@/services/infrastructure/redis.service";
import { LockBackendUnavailableError, TooManyRequestsError } from "@/util/errors";

const LOCK_PREFIX = "relay:channel-probe-lock:v1";
const LOCK_TTL_MS = 90_000;
const POLL_INTERVAL_MS = 100;

type LockMode = "read" | "write";

interface ProbeChannelLock {
  release(): Promise<void>;
}

/**
 * Coordinates user relay traffic and calibration probes for one independent
 * upstream channel. Readers are normal upstream calls; a probe is the sole
 * writer and covers both balance reads plus its minimal model request.
 */
export class RelayChannelProbeLockService {
  private static instance: RelayChannelProbeLockService;
  private readonly redis = RedisService.getInstance();

  public static getInstance(): RelayChannelProbeLockService {
    if (!this.instance) this.instance = new RelayChannelProbeLockService();
    return this.instance;
  }

  public async withRead<T>(channelId: string, operation: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
    const lock = await this.acquire(channelId, "read", timeoutMs);
    try {
      return await operation();
    } finally {
      await lock.release();
    }
  }

  public async withWrite<T>(channelId: string, operation: () => Promise<T>, timeoutMs = 60_000): Promise<T> {
    const lock = await this.acquire(channelId, "write", timeoutMs);
    try {
      return await operation();
    } finally {
      await lock.release();
    }
  }

  private async acquire(channelId: string, mode: LockMode, timeoutMs: number): Promise<ProbeChannelLock> {
    if (!this.redis.isRedisAvailable())
      throw new LockBackendUnavailableError("Relay channel probe coordination backend unavailable");

    const baseKey = `${LOCK_PREFIX}:${channelId}`;
    const owner = randomUUID();
    const deadline = Date.now() + Math.max(1_000, timeoutMs);
    let writeQueued = false;

    if (mode === "write") {
      const queued = await this.redis.reserveFairWriteLock(baseKey, owner, Math.max(LOCK_TTL_MS, timeoutMs + 5_000));
      if (queued === null)
        throw new LockBackendUnavailableError("Relay channel probe coordination backend unavailable");
      writeQueued = true;
    }

    try {
      while (Date.now() < deadline) {
        const acquired =
          mode === "read"
            ? await this.redis.tryAcquireFairReadLock(baseKey, owner, LOCK_TTL_MS)
            : await this.redis.tryAcquireFairWriteLock(baseKey, owner, LOCK_TTL_MS);
        if (acquired === null)
          throw new LockBackendUnavailableError("Relay channel probe coordination backend unavailable");
        if (acquired === true || acquired === "acquired") return this.createLease(baseKey, owner, mode);
        if (acquired === "stale") break;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (error) {
      if (writeQueued) await this.redis.releaseFairWriteLock(baseKey, owner).catch(() => null);
      throw error;
    }

    if (writeQueued) await this.redis.releaseFairWriteLock(baseKey, owner).catch(() => null);
    throw new TooManyRequestsError("Relay channel is busy with a calibration probe; please retry shortly");
  }

  private createLease(baseKey: string, owner: string, mode: LockMode): ProbeChannelLock {
    let released = false;
    let refreshing = false;
    const heartbeat = setInterval(
      () => {
        if (released || refreshing) return;
        refreshing = true;
        const refresh =
          mode === "read"
            ? this.redis.extendFairReadLock(baseKey, owner, LOCK_TTL_MS)
            : this.redis.extendIfValueMatches(`${baseKey}:writer`, owner, LOCK_TTL_MS);
        void refresh.finally(() => {
          refreshing = false;
        });
      },
      Math.floor(LOCK_TTL_MS / 3),
    );
    heartbeat.unref();

    return {
      release: async () => {
        if (released) return;
        released = true;
        clearInterval(heartbeat);
        if (mode === "read") await this.redis.releaseFairReadLock(baseKey, owner);
        else await this.redis.releaseFairWriteLock(baseKey, owner);
      },
    };
  }
}
