import { describe, expect, it, vi } from "vitest";
import { env } from "@/config/env";
import { AIRequestLogWriter } from "@/services/relay/ai-request-log-writer";
import { AIResourceService, aiResourceContext } from "@/services/infrastructure/ai-resource.service";
import { contentSafetyAttemptContext, withContentSafetyAttempt } from "@/services/system/content-safety-attempt";
import { AI_RESOURCE_DEFAULTS } from "@/config/ai-resource-policy";
import { budgetAuditPayload } from "@/util/ai-request-log-payload";

describe("bounded AI audit", () => {
  it("limits pending items, bytes and writes while coalescing queued diagnostics", async () => {
    const writer = new AIRequestLogWriter({
      ...env.aiRequestLog,
      writeConcurrency: 1,
      queueMaxItems: 1,
      queueMaxBytes: 100,
    });
    let finish!: () => void;
    const first = writer.enqueue(
      "first",
      50,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )!;
    await Promise.resolve();
    const old = vi.fn(async () => {});
    const next = vi.fn(async () => {});
    const queued = writer.enqueue("update", 40, old)!;
    expect(writer.enqueue("update", 80, next)).toBe(queued);
    expect(writer.enqueue("overflow", 1, async () => {})).toBeUndefined();
    expect(writer.snapshot()).toMatchObject({ running: 1, queued: 1, bytes: 80, dropped: 1 });
    finish();
    await first;
    await queued;
    expect(old).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
  it("omits malformed JSON and SSE even when the capture byte budget is not exhausted", () => {
    for (const input of ['{"api_key":"fixture-secret', 'data: {"api_key":"fixture-secret\n\n']) {
      const safe = budgetAuditPayload(input, 1024);
      expect(JSON.stringify(safe.value)).not.toContain("fixture-secret");
    }
  });

  it("never saves incomplete JSON credential fragments", () => {
    const payload = budgetAuditPayload({ _truncated: true, _preview: '{"api_key":"fixture-secret' }, 1024);
    expect(JSON.stringify(payload.value)).not.toContain("fixture-secret");
    expect(payload.truncated).toBe(true);
  });
  it("bounds deep or oversized payloads and masks credentials before persistence", () => {
    const payload = budgetAuditPayload(
      { api_key: "fixture-secret", data: "x".repeat(1_000_000), image: "y".repeat(1_000_000) },
      1024,
    );
    const serialized = JSON.stringify(payload.value);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(1024);
    expect(serialized).not.toContain("fixture-secret");
    expect(payload.truncated).toBe(true);
  });
  it("does not carry request resource or rule snapshots into queued database writes", async () => {
    const resources = new AIResourceService(AI_RESOURCE_DEFAULTS.aiResources, () => 0);
    const lease = resources.tryAcquire()!;
    const writer = new AIRequestLogWriter(AI_RESOURCE_DEFAULTS.aiRequestLog);
    let captured: unknown[] = [];
    await aiResourceContext.run(lease, () =>
      withContentSafetyAttempt(
        () =>
          writer.enqueue("snapshot", 1, async () => {
            captured = [aiResourceContext.getStore(), contentSafetyAttemptContext.getStore()];
          })!,
      ),
    );
    expect(captured).toEqual([undefined, undefined]);
    lease.release();
    resources.stop();
  });
});
