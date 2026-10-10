import { describe, expect, it, vi } from "vitest";
import { RelayProxyController } from "@/api/controllers/_unversioned/relay-proxy.controller";
import { EventEmitter } from "node:events";
describe("relay raw JSON response", () => {
  it("sends unchanged wire bytes and attaches the parsed body for bounded audit", async () => {
    const controller = new RelayProxyController() as any;
    controller.relayTokenService = { validateToken: vi.fn(async () => ({ userId: "u", id: "t" })) };
    const raw = Buffer.from('{ "usage":{"prompt_tokens":1}, "text":"中文" }');
    const parsed = JSON.parse(raw.toString());
    controller.relayProxyService = {
      forwardRequest: vi.fn(async () => ({
        status: 200,
        headers: { "content-type": "application/json", "content-length": raw.length, "x-request-id": "r" },
        data: parsed,
        rawBody: raw,
      })),
    };
    const response = Object.assign(new EventEmitter(), {
      locals: {},
      status: vi.fn(),
      setHeader: vi.fn(),
      end: vi.fn(),
    });
    const request = { headers: { authorization: "Bearer sk-rlt-fixture-relay-token" }, res: response };
    await controller.handleRequest(request);
    expect(response.end).toHaveBeenCalledWith(raw);
    expect((response.locals as any).responseBody).toBe(parsed);
    expect((response.locals as any).preparedAuditBody).toBe(true);
    expect(response.setHeader).not.toHaveBeenCalledWith("content-length", expect.anything());
  });
});
