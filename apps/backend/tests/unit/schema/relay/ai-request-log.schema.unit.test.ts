import { describe, expect, it } from "vitest";
import { aiRequestLogListQuerySchema } from "@/api/schema/relay/ai-request-log.schema";

describe("aiRequestLogListQuerySchema", () => {
  it("parses explicit false instead of coercing every non-empty string to true", () => {
    expect(aiRequestLogListQuerySchema.parse({ truncated: "false" }).truncated).toBe(false);
    expect(aiRequestLogListQuerySchema.parse({ truncated: "true" }).truncated).toBe(true);
  });

  it("rejects invalid status codes and dates", () => {
    expect(aiRequestLogListQuerySchema.safeParse({ statusCode: "99" }).success).toBe(false);
    expect(aiRequestLogListQuerySchema.safeParse({ startDate: "not-a-date" }).success).toBe(false);
  });
});
