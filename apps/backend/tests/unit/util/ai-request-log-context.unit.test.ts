import type { Response } from "express";
import { describe, expect, it } from "vitest";
import {
  getAIRequestLogContext,
  setAIRequestLogContext,
  recordAIRequestAttempt,
  ensureAIRequestLogId,
} from "@/util/ai-request-log-context";

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
  it("allocates a stable logical ID independently of caller-controlled IDs", () => {
    const response = { locals: {} } as Response;
    const id = ensureAIRequestLogId(response);
    expect(ensureAIRequestLogId(response)).toBe(id);
  });
  it("bounds per-attempt and aggregate error text and protects terminal outcomes", () => {
    const response = { locals: {} } as Response;
    setAIRequestLogContext(response, { outcome: "pending" });
    for (let i = 0; i < 8; i++)
      recordAIRequestAttempt(response, { success: false, statusCode: 503, error: "中".repeat(20000) });
    const context = getAIRequestLogContext(response)!;
    expect(context.attempts!.every((row) => Buffer.byteLength(row.errorExcerpt ?? "") <= 16384)).toBe(true);
    expect(
      context.attempts!.reduce((sum, row) => sum + Buffer.byteLength(row.errorExcerpt ?? ""), 0),
    ).toBeLessThanOrEqual(65536);
    expect(context.attemptsTruncated).toBe(true);
    setAIRequestLogContext(response, { outcome: "failed", failureStage: "settlement" });
    setAIRequestLogContext(response, { outcome: "success" });
    expect(getAIRequestLogContext(response)!.outcome).toBe("failed");
  });
});
