import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAiResourcesConfig } from "@/config/env/ai-resources";
import { AIResourceService, aiResourceContext } from "@/services/infrastructure/ai-resource.service";
import { aiResourceGuard } from "@/middleware/ai-resource-guard";

function request(path = "/v1/support/messages") {
  return Object.assign(new EventEmitter(), { path, method: "POST", headers: {} }) as any;
}
function response() {
  return Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false }) as any;
}
let service: AIResourceService;
function setup() {
  service = new AIResourceService(
    buildAiResourcesConfig({ AI_MAX_ACTIVE_REQUESTS: "1", AI_MAX_QUEUED_REQUESTS: "1" }),
    () => 0,
  );
  vi.spyOn(AIResourceService, "getInstance").mockReturnValue(service);
}
afterEach(() => {
  service?.stop();
  vi.restoreAllMocks();
});
describe("pre-parser AI admission", () => {
  it("leaves waiting request bodies unread and binds admitted callbacks to their root", async () => {
    setup();
    const occupied = await service.acquire();
    const req = request();
    const res = response();
    const next = vi.fn(() => {
      expect(aiResourceContext.getStore()).toBeDefined();
    });
    aiResourceGuard(req, res, next);
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
    expect(req.listenerCount("data")).toBe(0);
    occupied.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(next).toHaveBeenCalledOnce();
    res.writableEnded = true;
    res.emit("finish");
    res.emit("close");
    expect(service.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });
  it("cancels unread waiters immediately on response disconnect", async () => {
    setup();
    const occupied = await service.acquire();
    const req = request();
    const res = response();
    const next = vi.fn();
    aiResourceGuard(req, res, next);
    res.emit("close");
    await Promise.resolve();
    await Promise.resolve();
    expect(service.snapshot().queued).toBe(0);
    expect(next).not.toHaveBeenCalled();
    occupied.release();
  });
  it("does not confuse a normal request close with an aborted response", async () => {
    setup();
    const req = request("/v1/chat/conversations/test/messages");
    const res = response();
    const next = vi.fn();
    aiResourceGuard(req, res, next);
    await Promise.resolve();
    await Promise.resolve();
    req.emit("close");
    expect(service.snapshot().active).toBe(1);
    res.emit("close");
    expect(service.snapshot().active).toBe(0);
  });
});
