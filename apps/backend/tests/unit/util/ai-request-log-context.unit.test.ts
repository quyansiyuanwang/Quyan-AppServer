import type { Response } from "express";
import { describe, expect, it } from "vitest";
import { getAIRequestLogContext, setAIRequestLogContext } from "@/util/ai-request-log-context";

describe("AI request log context", () => {
  it("creates locals on partial response doubles and merges context", () => {
    const response = {} as Response;

    setAIRequestLogContext(response, { requestId: "relay-1", model: "gpt-4o-mini" });
    setAIRequestLogContext(response, { userId: "user-1" });

    expect(getAIRequestLogContext(response)).toEqual({
      requestId: "relay-1",
      model: "gpt-4o-mini",
      userId: "user-1",
    });
  });

  it("ignores missing and non-extensible responses without throwing", () => {
    const response = Object.freeze({}) as Response;

    expect(() => setAIRequestLogContext(undefined, { requestId: "relay-2" })).not.toThrow();
    expect(() => setAIRequestLogContext(response, { requestId: "relay-3" })).not.toThrow();
    expect(getAIRequestLogContext(response)).toBeUndefined();
  });
});
