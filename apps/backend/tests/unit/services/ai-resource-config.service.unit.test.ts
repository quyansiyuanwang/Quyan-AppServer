import { env } from "@/config/env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIResourceConfigService } from "@/services/infrastructure/ai-resource-config.service";
import { AI_RESOURCE_DEFAULTS, AI_RESOURCE_FIELDS } from "@/config/ai-resource-policy";
import { AIResourceService, aiResourceContext } from "@/services/infrastructure/ai-resource.service";
import { AIHttpAgentPool } from "@/services/infrastructure/ai-http-agent-pool";
import { ConfigService } from "@/services/system/config.service";
import { AI_RESOURCE_CONFIG_KEY } from "@/config/ai-resource-policy";
import { AIRequestLogWriter } from "@/services/relay/ai-request-log-writer";
const singleton = AIResourceConfigService.getInstance();
afterEach(() => {
  singleton.apply(structuredClone(AI_RESOURCE_DEFAULTS));
  vi.useRealTimers();
});
function repository(value: string | null = null) {
  let row = value ? { value, updateTime: new Date("2026-10-10T00:00:00Z") } : null;
  return {
    findByKey: vi.fn(async () => row),
    set(next: string, time = new Date("2026-10-10T00:00:01Z")) {
      row = { value: next, updateTime: time };
    },
  };
}
describe("dynamic AI resources", () => {
  it("publishes defaults and field units from the server without duplicate client constants", () => {
    const service = new AIResourceConfigService(repository() as any);
    const info = service.describe();
    expect(info.defaults.aiResources.maxActiveRequests).toBe(3);
    expect(info.defaults.ruleCache.maxItems).toBe(512);
    expect(AI_RESOURCE_FIELDS.find((f) => f.path === "chat.resourceLimits.contextMaxMessages")?.min).toBe(0);
  });
  it("validates the complete document and relationships instead of clamping valid increases", () => {
    const service = new AIResourceConfigService(repository() as any);
    const next = structuredClone(AI_RESOURCE_DEFAULTS);
    next.aiResources.maxActiveRequests = 12;
    next.chat.resourceLimits.contextMaxMessages = 0;
    expect(service.parse(JSON.stringify(next)).aiResources.maxActiveRequests).toBe(12);
    next.aiResources.memory.resumeWatermarkBytes = next.aiResources.memory.highWatermarkBytes;
    expect(() => service.parse(JSON.stringify(next))).toThrow("Invalid AI resource");
    expect(() => service.parse('{"version":1}')).toThrow();
  });
  it("fills new fields in persisted version 1 settings without resetting existing capacity", () => {
    const service = new AIResourceConfigService(repository() as any);
    const previous = structuredClone(AI_RESOURCE_DEFAULTS) as any;
    previous.aiResources.maxActiveRequests = 12;
    delete previous.aiResources.http.keepAliveMsecs;
    delete previous.aiResources.http.socketTimeoutMs;
    delete previous.relay.resourceGuard.jsonBodyLimitMb;
    delete previous.relay.resourceGuard.downstreamIdleTimeoutMs;
    const parsed = service.parse(JSON.stringify(previous));
    expect(parsed.aiResources.maxActiveRequests).toBe(12);
    expect(parsed.aiResources.http.keepAliveMsecs).toBe(env.aiResources.http.keepAliveMsecs);
    expect(parsed.aiResources.http.socketTimeoutMs).toBe(env.aiResources.http.socketTimeoutMs);
    expect(parsed.relay.resourceGuard.jsonBodyLimitMb).toBe(env.relay.resourceGuard.jsonBodyLimitMb);
    expect(parsed.relay.resourceGuard.downstreamIdleTimeoutMs).toBe(env.relay.resourceGuard.downstreamIdleTimeoutMs);
  });
  it.each([0, -1, 0.5, null, 2147483648])("rejects invalid new timeout value %s", (value) => {
    const service = new AIResourceConfigService(repository() as any);
    const next = structuredClone(AI_RESOURCE_DEFAULTS) as any;
    next.aiResources.http.socketTimeoutMs = value;
    expect(() => service.parse(JSON.stringify(next))).toThrow();
    next.aiResources.http.socketTimeoutMs = AI_RESOURCE_DEFAULTS.aiResources.http.socketTimeoutMs;
    next.relay.resourceGuard.downstreamIdleTimeoutMs = value;
    expect(() => service.parse(JSON.stringify(next))).toThrow();
  });
  it("rotates connection timers without destroying in-flight sockets", () => {
    const pool = new AIHttpAgentPool();
    const original = pool.acquire(AI_RESOURCE_DEFAULTS.aiResources.http);
    const oldDestroy = vi.spyOn(original.agents.httpAgent, "destroy");
    const limits = { ...AI_RESOURCE_DEFAULTS.aiResources.http, keepAliveMsecs: 12345, socketTimeoutMs: 67890 };
    pool.rotate(limits);
    const current = pool.acquire(limits);
    expect(current.agents.httpAgent).not.toBe(original.agents.httpAgent);
    expect(Reflect.get(current.agents.httpAgent, "options")).toMatchObject({ keepAliveMsecs: 12345, timeout: 67890 });
    expect(oldDestroy).not.toHaveBeenCalled();
    original.release();
    expect(oldDestroy).toHaveBeenCalledOnce();
    current.release();
    pool.rotate(AI_RESOURCE_DEFAULTS.aiResources.http);
  });
  it("refreshes other processes every five seconds and keeps the last snapshot on failures", async () => {
    vi.useFakeTimers();
    const repo = repository(JSON.stringify(AI_RESOURCE_DEFAULTS));
    const service = new AIResourceConfigService(repo as any);
    await service.start();
    const next = structuredClone(AI_RESOURCE_DEFAULTS);
    next.aiResources.maxActiveRequests = 9;
    repo.set(JSON.stringify(next));
    await vi.advanceTimersByTimeAsync(5000);
    expect(service.current.aiResources.maxActiveRequests).toBe(9);
    repo.findByKey.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(service.current.aiResources.maxActiveRequests).toBe(9);
    service.stop();
  });
  it("uses database settings over bootstrap environment values and retains a valid snapshot after malformed data", async () => {
    const next = structuredClone(AI_RESOURCE_DEFAULTS);
    next.aiResources.maxActiveRequests = 17;
    const repo = repository(JSON.stringify(next));
    const service = new AIResourceConfigService(repo as any);
    await service.refresh();
    expect(service.describe().source).toBe("database");
    expect(service.current.aiResources.maxActiveRequests).toBe(17);
    repo.set('{"version":1}');
    await expect(service.refresh()).rejects.toThrow();
    expect(service.current.aiResources.maxActiveRequests).toBe(17);
  });
  it("does not replace a local save with an older in-flight refresh", async () => {
    let finish!: (value: any) => void;
    const service = new AIResourceConfigService({
      findByKey: () =>
        new Promise((r) => {
          finish = r;
        }),
    } as any);
    const refresh = service.refresh();
    const next = structuredClone(AI_RESOURCE_DEFAULTS);
    next.aiResources.maxActiveRequests = 10;
    service.apply(next, "new");
    finish({ value: JSON.stringify(AI_RESOURCE_DEFAULTS), updateTime: new Date() });
    await refresh;
    expect(service.current.aiResources.maxActiveRequests).toBe(10);
  });
  it("pins inherited content budgets while admission consumes current limits", async () => {
    const resources = new AIResourceService(undefined, () => 0);
    const lease = resources.tryAcquire()!;
    const next = structuredClone(AI_RESOURCE_DEFAULTS);
    next.chat.resourceLimits.contextLimitBytes = 123456;
    next.aiResources.maxActiveRequests = 1;
    singleton.apply(next);
    expect(lease.resourceConfig.chat.resourceLimits.contextLimitBytes).toBe(
      AI_RESOURCE_DEFAULTS.chat.resourceLimits.contextLimitBytes,
    );
    expect(resources.tryAcquire()).toBeUndefined();
    expect(aiResourceContext.run(lease, () => lease.resourceConfig)).toBe(lease.resourceConfig);
    lease.release();
    expect(resources.snapshot().active).toBe(0);
    resources.stop();
  });
  it("does not destroy active retired agents and releases them only once", () => {
    const pool = new AIHttpAgentPool();
    const old = pool.acquire(AI_RESOURCE_DEFAULTS.aiResources.http);
    const destroy = vi.spyOn(old.agents.httpAgent, "destroy");
    pool.rotate({ ...AI_RESOURCE_DEFAULTS.aiResources.http, maxTotalSockets: 16 });
    expect(destroy).not.toHaveBeenCalled();
    old.release();
    old.release();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
  it("retires agents created late from an older request snapshot", () => {
    const pool = new AIHttpAgentPool();
    pool.rotate({ ...AI_RESOURCE_DEFAULTS.aiResources.http, maxTotalSockets: 16 });
    const old = pool.acquire(AI_RESOURCE_DEFAULTS.aiResources.http);
    const destroy = vi.spyOn(old.agents.httpAgent, "destroy");
    old.release();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
  it("lets accepted audit writes finish after lowering limits", async () => {
    let finish!: () => void;
    const writer = new AIRequestLogWriter();
    const task = writer.enqueue(
      "a",
      100,
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    await Promise.resolve();
    const next = structuredClone(AI_RESOURCE_DEFAULTS);
    next.aiRequestLog.queueMaxBytes = 1;
    singleton.apply(next);
    expect(writer.enqueue("b", 100, async () => {})).toBeUndefined();
    finish();
    await task;
    expect(writer.snapshot().running).toBe(0);
  });
  it("rejects unknown nested settings and permits byte capacities above timer limits", () => {
    const service = new AIResourceConfigService(repository() as any);
    const next = structuredClone(AI_RESOURCE_DEFAULTS);
    next.aiRequestLog.queueMaxBytes = 3 * 1024 ** 3;
    expect(service.parse(JSON.stringify(next)).aiRequestLog.queueMaxBytes).toBe(3 * 1024 ** 3);
    (next.aiResources.http as any).unexpected = 1;
    expect(() => service.parse(JSON.stringify(next))).toThrow();
    const mbField = AI_RESOURCE_FIELDS.find((field) => field.path === "relay.resourceGuard.maxUpstreamResponseBodyMb")!;
    expect(mbField.max).toBe(2147483647);
  });
  it("validates a full management update before writes and immediately publishes a single atomic row", async () => {
    const service = Object.create(ConfigService.prototype) as any;
    service.serverConfigRepository = { upsert: vi.fn(async () => ({ updateTime: new Date("2026-10-10T01:00:00Z") })) };
    const next = structuredClone(AI_RESOURCE_DEFAULTS);
    next.aiResources.maxActiveRequests = 8;
    await service.setMultiple({ [AI_RESOURCE_CONFIG_KEY]: JSON.stringify(next) });
    expect(service.serverConfigRepository.upsert).toHaveBeenCalledTimes(1);
    expect(singleton.current.aiResources.maxActiveRequests).toBe(8);
    service.serverConfigRepository.upsert.mockClear();
    await expect(service.setMultiple({ other: "value", [AI_RESOURCE_CONFIG_KEY]: "{}" })).rejects.toThrow();
    expect(service.serverConfigRepository.upsert).not.toHaveBeenCalled();
  });
  it("retains bootstrap settings when the initial refresh fails and isolates subscriber errors", async () => {
    const repo = repository();
    repo.findByKey.mockRejectedValue(new Error("offline"));
    const service = new AIResourceConfigService(repo as any);
    await service.start();
    expect(service.current.aiResources.maxActiveRequests).toBe(AI_RESOURCE_DEFAULTS.aiResources.maxActiveRequests);
    service.subscribe(() => {
      throw new Error("subscriber");
    });
    const listener = vi.fn();
    service.subscribe(listener);
    service.apply(structuredClone(AI_RESOURCE_DEFAULTS));
    expect(listener).toHaveBeenCalledOnce();
    service.stop();
  });
  it("uses legacy environment only until a management document exists", async () => {
    const previous = env.aiResources.maxActiveRequests;
    const present = env.legacyAIResourceEnvironmentPresent;
    try {
      env.aiResources.maxActiveRequests = 7;
      (env as any).legacyAIResourceEnvironmentPresent = true;
      const repo = repository();
      const service = new AIResourceConfigService(repo as any);
      expect(service.describe().source).toBe("legacy-env");
      expect(service.current.aiResources.maxActiveRequests).toBe(7);
      repo.set(JSON.stringify(AI_RESOURCE_DEFAULTS));
      await service.refresh();
      expect(service.current.aiResources.maxActiveRequests).toBe(3);
      expect(service.describe().source).toBe("database");
      expect(service.describe().legacyEnvironmentPresent).toBe(true);
    } finally {
      env.aiResources.maxActiveRequests = previous;
      (env as any).legacyAIResourceEnvironmentPresent = present;
    }
  });
});
