import { describe, expect, it } from "vitest";
import { iamManagementSearchPaginationSchema } from "@/iam/management-pagination";
describe("IAM management search contract", () => {
  it("normalizes a bounded literal search term", () => {
    expect(iamManagementSearchPaginationSchema.parse({ keyword: "  literal%_*  " })).toEqual({
      page: 1,
      pageSize: 50,
      keyword: "literal%_*",
    });
  });
  it.each(["x".repeat(101), "before\u0000after", "before\nafter", "before\u007fafter"])(
    "rejects oversized or control-character terms %#",
    (keyword) => {
      expect(iamManagementSearchPaginationSchema.safeParse({ keyword }).success).toBe(false);
    },
  );
  it("does not accept account or Action overrides", () => {
    for (const query of [{ accountOwnerId: "other" }, { action: "quyan:ram:DeleteUser" }])
      expect(iamManagementSearchPaginationSchema.safeParse(query).success).toBe(false);
  });
});
