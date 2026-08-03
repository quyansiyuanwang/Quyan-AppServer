import { describe, expect, it } from "vitest";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";

describe("business-log-context util", () => {
  it("returns unknown defaults when request is missing", () => {
    expect(buildBusinessLogRequestContext()).toEqual({
      ipAddress: "unknown",
      requestId: "unknown",
    });
  });

  it("extracts request metadata from headers and connection info", () => {
    const context = buildBusinessLogRequestContext({
      headers: {
        "x-forwarded-for": "203.0.113.8, 10.0.0.1",
        "user-agent": "Vitest Agent",
        "x-request-id": "req-123",
      },
      ip: "::1",
      socket: { remoteAddress: "::ffff:127.0.0.1" },
    } as any);

    expect(context).toEqual({
      ipAddress: "203.0.113.8",
      userAgent: "Vitest Agent",
      requestId: "req-123",
    });
  });

  it("falls back to unknown requestId when header is absent", () => {
    const context = buildBusinessLogRequestContext({
      headers: {},
      ip: "::1",
      socket: { remoteAddress: "::ffff:127.0.0.1" },
    } as any);

    expect(context.requestId).toBe("unknown");
    expect(context.ipAddress).toBe("127.0.0.1");
  });
});
