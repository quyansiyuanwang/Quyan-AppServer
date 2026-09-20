import { z } from "zod";
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("ChinaHolidayCalendar", LogCategory.SYSTEM);
// Fixed provider and bounded I/O; never send channel credentials to the calendar provider.
const POLICY = {
  source: "https://timor.tech/api/holiday/year/",
  refreshMs: 24 * 60 * 60 * 1000,
  retryMs: 60 * 60 * 1000,
  timeoutMs: 10_000,
  maxBytes: 256 * 1024,
  cacheTtlSeconds: 400 * 24 * 60 * 60,
};
const providerSchema = z.object({
  code: z.literal(0),
  holiday: z.record(z.string(), z.object({ holiday: z.boolean(), date: z.string() })),
});
const snapshotSchema = z.object({ fetchedAt: z.number().finite(), payload: providerSchema });
type Snapshot = z.infer<typeof snapshotSchema>;

const chinaFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function getChinaCalendarDate(now: Date) {
  const parts = Object.fromEntries(chinaFormatter.formatToParts(now).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { date, dayOfWeek: day || 7, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Reject empty/unpublished, wrong-year, malformed and obviously partial annual calendars. */
export function parseChinaHolidayYear(payload: unknown, year: number) {
  const parsed = providerSchema.parse(payload);
  for (const [key, entry] of Object.entries(parsed.holiday)) {
    if (
      !/^\d{2}-\d{2}$/.test(key) ||
      entry.date !== `${year}-${key}` ||
      !Number.isFinite(Date.parse(`${entry.date}T00:00:00Z`)) ||
      new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10) !== entry.date
    ) {
      throw new Error("Invalid holiday date");
    }
  }
  // These fixed holidays must exist in every published full-year Chinese calendar.
  if (!["01-01", "05-01", "10-01"].every((key) => parsed.holiday[key]?.holiday === true)) {
    throw new Error("Incomplete holiday year");
  }
  return parsed;
}

interface CalendarDependencies {
  now: () => number;
  load: (key: string) => Promise<string | null>;
  save: (key: string, value: string) => Promise<void>;
  fetchYear: (year: number) => Promise<unknown>;
  warn: (message: string, year: number) => void;
}
const defaults: CalendarDependencies = {
  now: Date.now,
  load: async (key) => {
    const { RedisService } = await import("@/services/infrastructure/redis.service");
    return RedisService.getInstance().get(key);
  },
  save: async (key, value) => {
    const { RedisService } = await import("@/services/infrastructure/redis.service");
    await RedisService.getInstance().set(key, value, POLICY.cacheTtlSeconds);
  },
  fetchYear: async (year) => {
    const response = await fetch(`${POLICY.source}${year}`, {
      signal: AbortSignal.timeout(POLICY.timeoutMs),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Holiday provider unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty holiday response");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > POLICY.maxBytes) throw new Error("Holiday response too large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  },
  warn: (message, year) => logger.warn(message, { year }),
};

export class ChinaHolidayCalendarService {
  private static instance: ChinaHolidayCalendarService;
  private readonly snapshots = new Map<number, Snapshot>();
  private readonly pending = new Map<number, Promise<void>>();
  private readonly retryAt = new Map<number, number>();
  private readonly warnedAt = new Map<number, number>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly deps: CalendarDependencies = defaults) {}

  static getInstance() {
    return (this.instance ??= new ChinaHolidayCalendarService());
  }

  isHoliday(date: string): boolean | undefined {
    const year = Number(date.slice(0, 4));
    const snapshot = this.snapshots.get(year);
    if (!snapshot) {
      const now = this.deps.now();
      if (now >= (this.warnedAt.get(year) ?? 0)) {
        this.warnedAt.set(year, now + POLICY.retryMs);
        this.deps.warn("Holiday calendar unavailable; skipping holiday-dependent multiplier rules", year);
      }
      return undefined;
    }
    return snapshot.payload.holiday[date.slice(5)]?.holiday === true;
  }

  start() {
    if (this.timer) return;
    void this.refreshCurrentYears();
    this.timer = setInterval(() => void this.refreshCurrentYears(), POLICY.retryMs);
    this.timer.unref();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.allSettled(this.pending.values());
  }

  private async refreshCurrentYears() {
    const year = Number(getChinaCalendarDate(new Date(this.deps.now())).date.slice(0, 4));
    for (const map of [this.snapshots, this.retryAt, this.warnedAt]) {
      for (const key of map.keys()) if (key < year - 1 || key > year + 1) map.delete(key);
    }
    await Promise.all([this.refreshYear(year), this.refreshYear(year + 1)]);
  }

  refreshYear(year: number): Promise<void> {
    const pending = this.pending.get(year);
    if (pending) return pending;
    if (this.deps.now() < (this.retryAt.get(year) ?? 0)) return Promise.resolve();
    const task = this.refresh(year).finally(() => this.pending.delete(year));
    this.pending.set(year, task);
    return task;
  }

  private async refresh(year: number) {
    const key = `relay:china-holiday:v1:${year}`;
    const currentYear = Number(getChinaCalendarDate(new Date(this.deps.now())).date.slice(0, 4));
    this.retryAt.set(year, this.deps.now() + (year > currentYear ? POLICY.refreshMs : POLICY.retryMs));
    try {
      const raw = await this.deps.load(key);
      if (raw) {
        const cached = snapshotSchema.parse(JSON.parse(raw));
        cached.payload = parseChinaHolidayYear(cached.payload, year);
        if (cached.fetchedAt > this.deps.now()) throw new Error("Future calendar snapshot");
        if (cached.fetchedAt > (this.snapshots.get(year)?.fetchedAt ?? 0)) this.snapshots.set(year, cached);
      }
    } catch {
      this.deps.warn("Holiday cache read failed; retaining last valid calendar", year);
    }
    const existing = this.snapshots.get(year);
    if (existing && this.deps.now() - existing.fetchedAt < POLICY.refreshMs) return;
    try {
      const payload = parseChinaHolidayYear(await this.deps.fetchYear(year), year);
      const snapshot = { fetchedAt: this.deps.now(), payload };
      this.snapshots.set(year, snapshot);
      await this.deps.save(key, JSON.stringify(snapshot));
    } catch {
      this.deps.warn("Holiday calendar refresh failed; retaining last valid calendar if available", year);
    }
  }
}
