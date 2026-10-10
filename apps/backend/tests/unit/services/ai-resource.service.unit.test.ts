import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/config/env";
import { buildAiResourcesConfig } from "@/config/env/ai-resources";
import { AIResourceService, aiResourceContext, AI_LEASE_HEADER } from "@/services/infrastructure/ai-resource.service";

const services: AIResourceService[] = [];
function create(source: Record<string, string> = {}, rss = () => 0) {
  const service = new AIResourceService(
    buildAiResourcesConfig({ AI_MAX_ACTIVE_REQUESTS: "1", AI_MAX_QUEUED_REQUESTS: "1", ...source }),
    rss,
  );
  services.push(service);
  return service;
}
afterEach(() => {
  services.splice(0).forEach((service) => service.stop());
  vi.useRealTimers();
});
describe("AI resource admission", () => {
  it("honors larger active budgets in actual admission and allows zero waiters", async () => {
    const service = create({ AI_MAX_ACTIVE_REQUESTS: "8", AI_MAX_QUEUED_REQUESTS: "0" });
    const leases = await Promise.all(Array.from({ length: 8 }, () => service.acquire()));
    expect(service.snapshot().active).toBe(8);
    await expect(service.acquire()).rejects.toMatchObject({ statusCode: 429 });
    leases.forEach((lease) => lease.release());
    expect(service.snapshot().active).toBe(0);
  });

  it("bounds active/queued work, releases once and admits FIFO", async () => {
    const service = create();
    const first = await service.acquire();
    const second = service.acquire();
    await expect(service.acquire()).rejects.toMatchObject({ statusCode: 429 });
    expect(service.snapshot()).toMatchObject({ active: 1, queued: 1 });
    first.release();
    first.release();
    const lease = await second;
    expect(service.snapshot()).toMatchObject({ active: 1, queued: 0 });
    lease.release();
    expect(service.snapshot().active).toBe(0);
  });
  it("cancels waiters and times out bounded queues", async () => {
    vi.useFakeTimers();
    const service = create({ AI_QUEUE_TIMEOUT_MS: "10" });
    const first = await service.acquire();
    const controller = new AbortController();
    const waiting = service.acquire(controller.signal);
    const cancelled = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await cancelled;
    expect(service.snapshot().queued).toBe(0);
    const timeout = expect(service.acquire()).rejects.toMatchObject({ statusCode: 429 });
    await vi.advanceTimersByTimeAsync(11);
    await timeout;
    first.release();
  });
  it("uses RSS hysteresis without killing existing work", async () => {
    let rss = 0;
    const service = create({}, () => rss);
    const lease = await service.acquire();
    rss = 513 * 1024 * 1024;
    service.sample();
    expect(lease.active).toBe(true);
    await expect(service.acquire()).rejects.toMatchObject({ statusCode: 429 });
    lease.release();
    rss = 480 * 1024 * 1024;
    service.sample();
    expect(service.tryAcquire()).toBeUndefined();
    rss = 448 * 1024 * 1024;
    service.sample();
    service.tryAcquire()!.release();
  });
  it("binds internal hops to live roots, authorization and paths; capabilities are one-use", async () => {
    const service = create();
    const lease = await service.acquire();
    const url = `https://${env.runtime.trustedRootDomains[0]}/relay/proxy/v1/chat/completions`;
    const headers = aiResourceContext.run(lease, () => service.hopHeaders(url, "Bearer fixture-only"));
    const ticket = headers[AI_LEASE_HEADER];
    expect(service.consumeHop("forged", new URL(url).pathname, "Bearer fixture-only")).toBeUndefined();
    expect(service.consumeHop(ticket, new URL(url).pathname, "Bearer wrong")).toBeUndefined();
    const hop = service.consumeHop(ticket, new URL(url).pathname, "Bearer fixture-only")!;
    expect(hop.lease).toBe(lease);
    expect(service.consumeHop(ticket, new URL(url).pathname, "Bearer fixture-only")).toBeUndefined();
    lease.release();
    expect(service.snapshot().active).toBe(1);
    hop.release();
    hop.release();
    expect(service.snapshot().active).toBe(0);
    expect(service.consumeHop(ticket, new URL(url).pathname, "Bearer fixture-only")).toBeUndefined();
  });
});
