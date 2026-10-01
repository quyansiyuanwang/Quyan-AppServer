import { describe, expect, it } from "vitest";
import {
  aiRequestLogListQuerySchema,
  aiRequestLogContentQuerySchema,
  aiRequestLogSearchQuerySchema,
} from "@/api/schema/relay/ai-request-log.schema";

describe("aiRequestLogListQuerySchema", () => {
  it("parses explicit false instead of coercing every non-empty string to true", () => {
    expect(aiRequestLogListQuerySchema.parse({ truncated: "false" }).truncated).toBe(false);
    expect(aiRequestLogListQuerySchema.parse({ truncated: "true" }).truncated).toBe(true);
  });

  it("rejects invalid status codes and dates", () => {
    expect(aiRequestLogListQuerySchema.safeParse({ statusCode: "99" }).success).toBe(false);
    expect(aiRequestLogListQuerySchema.safeParse({ startDate: "not-a-date" }).success).toBe(false);
  });
  it("rejects reversed time/duration ranges and unbounded content locations", () => {
    expect(
      aiRequestLogListQuerySchema.safeParse({ startDate: "2026-09-30T10:00:00Z", endDate: "2026-09-30T09:00:00Z" })
        .success,
    ).toBe(false);
    expect(aiRequestLogListQuerySchema.safeParse({ minDurationMs: 10, maxDurationMs: 9 }).success).toBe(false);
    expect(aiRequestLogContentQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(aiRequestLogContentQuerySchema.safeParse({ locator: "$.credentials" }).success).toBe(false);
    expect(aiRequestLogSearchQuerySchema.safeParse({ keyword: " " }).success).toBe(false);
  });
});
