import express from "express";
import http from "node:http";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "@/app";
import { AI_RESOURCE_DEFAULTS } from "@/config/ai-resource-policy";
import { AIResourceConfigService, getAIResourceConfig } from "@/services/infrastructure/ai-resource-config.service";
import { AIResourceService, aiResourceContext } from "@/services/infrastructure/ai-resource.service";
import { isRelayProxyPath, relayJsonBodyParser } from "@/middleware/relay-body-parser";
import { createRequestSizeGuard } from "@/middleware/request-size-guard";

const config = AIResourceConfigService.getInstance();
afterEach(() => {
  config.apply(structuredClone(AI_RESOURCE_DEFAULTS));
  vi.restoreAllMocks();
});

function fixtureApp() {
  const app = express();
  app.use((req, res, next) =>
    createRequestSizeGuard({
      maxJsonBytes: getAIResourceConfig().relay.resourceGuard.jsonBodyLimitMb * 1024 * 1024,
      maxMultipartBytes: 1024 * 1024,
      maxOtherBytes: 1024 * 1024,
    })(req, res, next),
  );
  app.use(relayJsonBodyParser);
  app.post("/relay/proxy/v1/chat/completions", (req, res) =>
    res.json({ bytes: Buffer.isBuffer(req.body) ? req.body.length : 0 }),
  );
  app.use(
    (
      error: { status?: number; statusCode?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => res.status(error.statusCode ?? error.status ?? 500).json({ failed: true }),
  );
  return app;
}

describe("dynamic relay request capacity", () => {
  it("uses new limits throughout the production parser chain without widening non-relay routes", async () => {
    const app = createApp();
    const payload = JSON.stringify({ model: "fixture-no-upstream", fixture: "x".repeat(6 * 1024 * 1024) });
    const next = structuredClone(AI_RESOURCE_DEFAULTS);
    next.relay.resourceGuard.jsonBodyLimitMb = 8;
    next.relay.resourceGuard.downstreamIdleTimeoutMs = 900000;
    config.apply(next);
    const timeout = vi.spyOn(http.ServerResponse.prototype, "setTimeout");
    const relay = await request(app).post("/relay/proxy/v1/chat/completions").type("json").send(payload);
    // Unauthenticated fixture: reaching authentication proves all parsers accepted it; no upstream request.
    expect(relay.status).toBe(401);
    expect(timeout).toHaveBeenCalledWith(900000, expect.any(Function));
    const ordinary = await request(app).post("/v1/auth/login").type("json").send(payload);
    expect(ordinary.status).toBe(413);
  });
  it("accepts an increased JSON limit without rebuilding the app, then enforces a decrease", async () => {
    const app = fixtureApp();
    const payload = JSON.stringify({ fixture: "x".repeat(6 * 1024 * 1024) });
    expect((await request(app).post("/relay/proxy/v1/chat/completions").type("json").send(payload)).status).toBe(413);
    const next = structuredClone(AI_RESOURCE_DEFAULTS);
    next.relay.resourceGuard.jsonBodyLimitMb = 8;
    config.apply(next);
    const accepted = await request(app).post("/relay/proxy/v1/chat/completions").type("json").send(payload);
    expect(accepted.status).toBe(200);
    expect(accepted.body.bytes).toBe(Buffer.byteLength(payload));
    config.apply(structuredClone(AI_RESOURCE_DEFAULTS));
    expect((await request(app).post("/relay/proxy/v1/chat/completions").type("json").send(payload)).status).toBe(413);
  });
  it("does not let vendor JSON bypass the pre-parser budget", async () => {
    const next = structuredClone(AI_RESOURCE_DEFAULTS);
    next.relay.resourceGuard.jsonBodyLimitMb = 1;
    config.apply(next);
    const response = await request(fixtureApp())
      .post("/relay/proxy/v1/chat/completions")
      .set("Content-Type", "application/vnd.fixture+json")
      .send(JSON.stringify({ fixture: "x".repeat(2 * 1024 * 1024) }));
    expect(response.status).toBe(413);
  });
  it("pins the body budget of an admitted request and excludes lookalike paths", async () => {
    const service = new AIResourceService(undefined, () => 0);
    const lease = service.tryAcquire()!;
    try {
      const next = structuredClone(AI_RESOURCE_DEFAULTS);
      next.relay.resourceGuard.jsonBodyLimitMb = 1;
      config.apply(next);
      expect(aiResourceContext.run(lease, () => getAIResourceConfig().relay.resourceGuard.jsonBodyLimitMb)).toBe(5);
      expect(getAIResourceConfig().relay.resourceGuard.jsonBodyLimitMb).toBe(1);
      expect(isRelayProxyPath("/relay/proxy/v1/chat/completions")).toBe(true);
      expect(isRelayProxyPath("/relay/proxy-lookalike")).toBe(false);
    } finally {
      lease.release();
      service.stop();
    }
  });
});
