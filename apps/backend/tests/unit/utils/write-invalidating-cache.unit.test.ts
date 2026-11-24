import { afterEach, describe, expect, it, vi } from "vitest";
import { WriteInvalidatingCache } from "@/util/write-invalidating-cache";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const options = { ttlMs: 100, maxEntries: 2 };

describe("write-invalidating cache", () => {
  afterEach(() => vi.useRealTimers());

  it("shares concurrent loads while returning isolated copies", async () => {
    const cache = new WriteInvalidatingCache<{ values: string[] }>(options);
    const pending = deferred<{ values: string[] }>();
    const load = vi.fn(() => pending.promise);
    const first = cache.get("key", "revision", load);
    const second = cache.get("key", "revision", load);
    pending.resolve({ values: ["original"] });
    const [left, right] = await Promise.all([first, second]);
    left.values.push("mutation");
    expect(right.values).toEqual(["original"]);
    expect(await cache.get("key", "revision", load)).toEqual({ values: ["original"] });
    expect(load).toHaveBeenCalledOnce();
  });

  it("validates revisions on every read, including updates made by another process", async () => {
    const cache = new WriteInvalidatingCache<string>(options);
    expect(await cache.get("key", "old", async () => "old")).toBe("old");
    expect(await cache.get("key", "new", async () => "new")).toBe("new");
  });

  it("expires entries and evicts the least recently read entry", async () => {
    vi.useFakeTimers();
    const cache = new WriteInvalidatingCache<string>(options);
    const load = vi.fn(async () => "value");
    await cache.get("a", "r", load);
    await cache.get("b", "r", load);
    await cache.get("a", "r", load);
    await cache.get("c", "r", load);
    await cache.get("b", "r", load);
    expect(load).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(options.ttlMs);
    await cache.get("b", "r", load);
    expect(load).toHaveBeenCalledTimes(5);
  });

  it("invalidates only after a successful transaction commit, and defaults to lazy refresh", async () => {
    const cache = new WriteInvalidatingCache<string>(options);
    const load = vi.fn(async () => "old");
    const refresh = vi.fn(async () => ({ revision: "new", value: "new" }));
    await cache.get("key", "old", load, refresh);
    const commit = deferred<number>();
    const write = cache.write(() => commit.promise);
    await cache.get("key", "old", load);
    expect(load).toHaveBeenCalledOnce();
    commit.resolve(42);
    expect(await write).toBe(42);
    expect(refresh).not.toHaveBeenCalled();
    await cache.get("key", "old", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("preserves entries after a failed or rolled-back write", async () => {
    const cache = new WriteInvalidatingCache<string>({ ...options, recomputeOnWrite: true });
    const load = vi.fn(async () => "old");
    const refresh = vi.fn();
    await cache.get("key", "r", load, refresh);
    await expect(
      cache.write(async () => {
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await cache.get("key", "r", load)).toBe("old");
    expect(load).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("eagerly recomputes with fresh committed snapshots when enabled", async () => {
    const cache = new WriteInvalidatingCache<string>({ ...options, recomputeOnWrite: true });
    const refresh = vi.fn(async () => ({ revision: "new", value: "new" }));
    await cache.get("key", "old", async () => "old", refresh);
    await cache.write(async () => "written");
    const load = vi.fn(async () => "unexpected");
    expect(await cache.get("key", "new", load)).toBe("new");
    expect(load).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
    await cache.write(async () => "written", false);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("never lets an old outstanding load repopulate an invalidated entry", async () => {
    const cache = new WriteInvalidatingCache<string>(options);
    const pending = deferred<string>();
    const first = cache.get("key", "r", () => pending.promise);
    await cache.write(async () => {});
    await cache.get("key", "r", async () => "new");
    pending.resolve("old");
    expect(await first).toBe("old"); // Already-started readers retain their admitted snapshot.
    expect(await cache.get("key", "r", async () => "unexpected")).toBe("new");
  });

  it("does not let an old failing load evict a newer revision", async () => {
    const cache = new WriteInvalidatingCache<string>(options);
    const pending = deferred<string>();
    const first = cache.get("key", "old", () => pending.promise);
    const failed = expect(first).rejects.toThrow("failed");
    await cache.get("key", "new", async () => "new");
    pending.reject(new Error("failed"));
    await failed;
    expect(await cache.get("key", "new", async () => "unexpected")).toBe("new");
  });

  it("cancels outdated warmup when a second write commits", async () => {
    const cache = new WriteInvalidatingCache<string>({ ...options, recomputeOnWrite: true });
    const warm = deferred<{ revision: string; value: string }>();
    await cache.get(
      "key",
      "old",
      async () => "old",
      () => warm.promise,
    );
    const firstWrite = cache.write(async () => {});
    await Promise.resolve();
    await cache.write(async () => {}, false);
    warm.resolve({ revision: "stale", value: "stale" });
    await firstWrite;
    const load = vi.fn(async () => "fresh");
    expect(await cache.get("key", "stale", load)).toBe("fresh");
    expect(load).toHaveBeenCalledOnce();
  });

  it("does not replace a reader's newer entry with a warmup snapshot", async () => {
    const cache = new WriteInvalidatingCache<string>({ ...options, recomputeOnWrite: true });
    const warm = deferred<{ revision: string; value: string }>();
    await cache.get(
      "key",
      "old",
      async () => "old",
      () => warm.promise,
    );
    const write = cache.write(async () => {});
    await Promise.resolve();
    await cache.get("key", "new", async () => "new");
    warm.resolve({ revision: "old", value: "old" });
    await write;
    expect(await cache.get("key", "new", async () => "unexpected")).toBe("new");
  });

  it("leaves cache cold after warmup failure without failing a committed write", async () => {
    const report = vi.fn(() => {
      throw new Error("logging failed");
    });
    const cache = new WriteInvalidatingCache<string>({ ...options, recomputeOnWrite: true, onRefreshError: report });
    await cache.get(
      "key",
      "r",
      async () => "old",
      async () => {
        throw new Error("unavailable");
      },
    );
    expect(await cache.write(async () => 42)).toBe(42);
    expect(report).toHaveBeenCalledOnce();
    expect(await cache.get("key", "r", async () => "fresh")).toBe("fresh");
  });

  it("retries failed initial loads and rejects invalid capacity settings", async () => {
    const cache = new WriteInvalidatingCache<string>(options);
    await expect(
      cache.get("key", "r", async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    expect(await cache.get("key", "r", async () => "retry")).toBe("retry");
    expect(() => new WriteInvalidatingCache({ ...options, ttlMs: 0 })).toThrow();
    expect(() => new WriteInvalidatingCache({ ...options, maxEntries: 0 })).toThrow();
  });
});
