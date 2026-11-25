export interface CacheSnapshot<T> {
  revision: string;
  value: T;
}

export interface WriteInvalidatingCacheOptions<T> {
  ttlMs: number;
  maxEntries: number;
  recomputeOnWrite?: boolean;
  clone?: (value: T) => T;
  onRefreshError?: () => void;
}

interface Entry<T> {
  revision: string;
  expiresAt: number;
  pending: Promise<T>;
  refresh?: () => Promise<CacheSnapshot<T>>;
}

/** Cache derived data only. Callers must validate revisions and authorization on every read. */
export class WriteInvalidatingCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly clone: (value: T) => T;
  private generation = 0;

  constructor(private readonly options: WriteInvalidatingCacheOptions<T>) {
    if (
      !Number.isFinite(options.ttlMs) ||
      options.ttlMs <= 0 ||
      !Number.isInteger(options.maxEntries) ||
      options.maxEntries < 1
    )
      throw new Error("Cache requires a positive TTL and entry limit");
    this.clone = options.clone ?? structuredClone;
  }

  async get(
    key: string,
    revision: string,
    load: () => Promise<T>,
    refresh?: () => Promise<CacheSnapshot<T>>,
  ): Promise<T> {
    const existing = this.entries.get(key);
    if (existing?.revision === revision && existing.expiresAt > Date.now()) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return this.clone(await existing.pending);
    }
    const entry: Entry<T> = { revision, expiresAt: Infinity, pending: Promise.resolve().then(load), refresh };
    this.put(key, entry);
    try {
      const value = this.clone(await entry.pending);
      entry.pending = Promise.resolve(value);
      entry.expiresAt = Date.now() + this.options.ttlMs;
      return this.clone(value);
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }
  }

  /** Pass the complete persistence operation, including the transaction commit. */
  async write<TResult>(
    persist: () => Promise<TResult>,
    recomputeOnWrite = this.options.recomputeOnWrite,
  ): Promise<TResult> {
    const result = await persist();
    await this.invalidate(recomputeOnWrite);
    return result;
  }

  async invalidate(recomputeOnWrite = this.options.recomputeOnWrite): Promise<void> {
    const previous = [...this.entries.entries()].filter(([, entry]) => entry.expiresAt > Date.now());
    const generation = ++this.generation;
    this.entries.clear(); // Clear synchronously before the first await; old loads cannot repopulate.
    if (!recomputeOnWrite) return;
    // Sequential refresh bounds database pressure. A newer write cancels the remaining warmup.
    for (const [key, entry] of previous) {
      if (generation !== this.generation) break;
      if (!entry.refresh) continue;
      try {
        const snapshot = await entry.refresh();
        if (generation !== this.generation) break;
        // A concurrent reader may already have loaded a more recent snapshot.
        if (!this.entries.has(key))
          this.put(key, {
            revision: snapshot.revision,
            expiresAt: Date.now() + this.options.ttlMs,
            pending: Promise.resolve(this.clone(snapshot.value)),
            refresh: entry.refresh,
          });
      } catch {
        // Persistence has committed. Cache warmup must never turn a successful write into a failure.
        try {
          this.options.onRefreshError?.();
        } catch {
          /* Diagnostics must not change write semantics. */
        }
      }
    }
  }

  private put(key: string, entry: Entry<T>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.options.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }
}
