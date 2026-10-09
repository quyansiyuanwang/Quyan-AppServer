import {
  AIResourceConfigService,
  getCurrentAIResourceConfig,
  registerAIResourceSnapshotReader,
} from "./ai-resource-config.service";
import { sharedAIHttpAgentPool, registerAIHttpAgentReader } from "./ai-http-agent-pool";
import type { AIResourceSettingsDto } from "@/api/dto/system/ai-resources.dto";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { env } from "@/config/env";
import { AI_REQUEST_LOG_PREFIX } from "@/constant/ai-request-log";
import { TooManyRequestsError } from "@/util/errors";

export const AI_LEASE_HEADER = "x-appserver-ai-lease";
export const aiResourceContext = new AsyncLocalStorage<AIResourceLease>();
registerAIResourceSnapshotReader(() => aiResourceContext.getStore()?.resourceConfig);
registerAIHttpAgentReader(() => aiResourceContext.getStore()?.agents);
export const aiCapacityError = () =>
  new TooManyRequestsError("AI resource capacity exhausted", undefined, undefined, {
    messageKey: "relayProxy.aiCapacityExceeded",
  });
export function aiAbortError(): Error {
  const error = new Error("AI request aborted");
  error.name = "AbortError";
  return error;
}

type Waiter = {
  resolve: (lease: AIResourceLease) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  start: number;
};
type Hop = { lease: AIResourceLease; authorizationHash: string; path: string };
const authorizationHash = (authorization: string) => createHash("sha256").update(authorization).digest("hex");

export class AIResourceLease {
  private references = 1;
  private released = false;
  readonly controller = new AbortController();
  childActive = false;
  readonly resourceConfig: AIResourceSettingsDto = getCurrentAIResourceConfig();
  private httpPool?: ReturnType<typeof sharedAIHttpAgentPool.acquire>;
  get agents() {
    return (this.httpPool ??= sharedAIHttpAgentPool.acquire(this.resourceConfig.aiResources.http)).agents;
  }
  readonly tickets = new Set<string>();
  constructor(
    private readonly owner: AIResourceService,
    public waitedMs = 0,
  ) {}
  get signal() {
    return this.controller.signal;
  }
  get active() {
    return !this.released && !this.signal.aborted;
  }
  retain(): () => void {
    if (!this.active) throw aiAbortError();
    this.references++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.release();
      }
    };
  }
  release(): void {
    if (this.released) return;
    if (--this.references > 0) return;
    this.released = true;
    this.httpPool?.release();
    this.httpPool = undefined;
    this.owner.finish(this);
  }
}

/** Per-process memory admission. Production runs one backend process; Redis still enforces user/image limits. */
export class AIResourceService {
  private static instance: AIResourceService;
  static getInstance() {
    return (this.instance ??= new AIResourceService());
  }
  private active = 0;
  private readonly waiters: Waiter[] = [];
  private readonly hops = new Map<string, Hop>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private pressured = false;
  private rss = 0;
  constructor(
    private readonly overrideConfig?: AIResourceSettingsDto["aiResources"],
    private readonly readRss = () => process.memoryUsage().rss,
  ) {}
  private get config() {
    return this.overrideConfig ?? getCurrentAIResourceConfig().aiResources;
  }
  private unsubscribe?: () => void;
  start(): void {
    if (this.timer) return;
    if (!this.overrideConfig && !this.unsubscribe)
      this.unsubscribe = AIResourceConfigService.getInstance().subscribe(() => {
        clearInterval(this.timer);
        this.timer = undefined;
        sharedAIHttpAgentPool.rotate(getCurrentAIResourceConfig().aiResources.http);
        this.start();
      });
    this.sample();
    this.timer = aiResourceContext.exit(() => setInterval(() => this.sample(), this.config.memory.sampleIntervalMs));
    this.timer.unref();
  }
  sample(): void {
    this.rss = this.readRss();
    if (this.rss >= this.config.memory.highWatermarkBytes) this.pressured = true;
    else if (this.rss <= this.config.memory.resumeWatermarkBytes) this.pressured = false;
    this.drain();
  }
  snapshot() {
    return { active: this.active, queued: this.waiters.length, rssBytes: this.rss, pressured: this.pressured };
  }
  tryAcquire(): AIResourceLease | undefined {
    this.start();
    if (this.pressured || this.active >= this.config.maxActiveRequests || this.waiters.length) return undefined;
    this.active++;
    return new AIResourceLease(this);
  }
  async acquire(signal?: AbortSignal): Promise<AIResourceLease> {
    if (signal?.aborted) throw aiAbortError();
    const lease = this.tryAcquire();
    if (lease) return lease;
    if (this.pressured || this.waiters.length >= this.config.maxQueuedRequests) throw aiCapacityError();
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error: Error) => {
        if (done) return;
        done = true;
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        waiter.cleanup();
        reject(error);
      };
      const abort = () => finish(aiAbortError());
      const timer = setTimeout(() => finish(aiCapacityError()), this.config.queueTimeoutMs);
      const waiter: Waiter = {
        start: Date.now(),
        reject: finish,
        resolve: (value) => {
          if (!done) {
            done = true;
            waiter.cleanup();
            resolve(value);
          }
        },
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        },
      };
      this.waiters.push(waiter);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  private drain(): void {
    while (!this.pressured && this.active < this.config.maxActiveRequests && this.waiters.length) {
      const waiter = this.waiters.shift()!;
      this.active++;
      waiter.resolve(new AIResourceLease(this, Date.now() - waiter.start));
    }
  }
  finish(lease: AIResourceLease): void {
    for (const ticket of lease.tickets) this.hops.delete(ticket);
    lease.tickets.clear();
    this.active--;
    this.drain();
  }
  /** A random one-use capability is bound to the live root, destination path and authorization. */
  hopHeaders(url: string, authorization: string): Record<string, string> {
    const lease = aiResourceContext.getStore();
    if (!lease) return {};
    const target = new URL(url);
    const trusted = env.runtime.trustedRootDomains.some(
      (root) => target.hostname === root || target.hostname.endsWith(`.${root}`),
    );
    if (!trusted || !target.pathname.startsWith(AI_REQUEST_LOG_PREFIX + "/")) return {};
    if (!lease.active) throw aiAbortError();
    if (lease.childActive) throw aiCapacityError();
    for (const ticket of lease.tickets) this.hops.delete(ticket);
    lease.tickets.clear();
    const ticket = randomBytes(32).toString("base64url");
    lease.tickets.add(ticket);
    this.hops.set(ticket, { lease, authorizationHash: authorizationHash(authorization), path: target.pathname });
    return { [AI_LEASE_HEADER]: ticket };
  }
  consumeHop(
    ticket: unknown,
    path: string,
    authorization: string,
  ): { lease: AIResourceLease; release: () => void } | undefined {
    if (typeof ticket !== "string") return undefined;
    const hop = this.hops.get(ticket);
    if (
      !hop ||
      !hop.lease.active ||
      hop.lease.childActive ||
      hop.path !== path ||
      hop.authorizationHash !== authorizationHash(authorization)
    )
      return undefined;
    this.hops.delete(ticket);
    hop.lease.tickets.delete(ticket);
    hop.lease.childActive = true;
    const release = hop.lease.retain();
    let done = false;
    return {
      lease: hop.lease,
      release: () => {
        if (!done) {
          done = true;
          hop.lease.childActive = false;
          release();
        }
      },
    };
  }
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const waiter of [...this.waiters]) waiter.reject(aiAbortError());
    this.hops.clear();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}

export async function withAIWork<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const service = AIResourceService.getInstance();
  const inherited = aiResourceContext.getStore();
  const lease = inherited ?? (await service.acquire(signal));
  const release = inherited ? lease.retain() : () => lease.release();
  try {
    return await aiResourceContext.run(lease, work);
  } finally {
    release();
  }
}

export async function* withAIGenerator<T>(
  factory: (signal: AbortSignal) => AsyncGenerator<T>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const inherited = aiResourceContext.getStore();
  const lease = inherited ?? (await AIResourceService.getInstance().acquire(signal));
  const release = inherited ? lease.retain() : () => lease.release();
  const combined = signal ? AbortSignal.any([signal, lease.signal]) : lease.signal;
  const generator = aiResourceContext.run(lease, () => factory(combined));
  try {
    while (true) {
      const result = await aiResourceContext.run(lease, () => generator.next());
      if (result.done) return;
      yield result.value;
    }
  } finally {
    try {
      await aiResourceContext.run(lease, () => generator.return(undefined as never));
    } finally {
      release();
    }
  }
}
