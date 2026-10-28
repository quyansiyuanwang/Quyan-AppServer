import { describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
import { Prisma } from "@prisma/client";
import { platformSqlRowNumber } from "@/store/system/platform-sql-row-number";
describe("legacy MySQL row ranking SQL", () => {
  it("binds the complete filtered source and compares null-safe tie keys without session variables", () => {
    const sql = platformSqlRowNumber(
      Prisma.sql`SELECT id,name FROM templates WHERE status=${1} AND name=${"fixture-only"}`,
      [
        { column: "name", current: Prisma.sql`t.name`, direction: "asc" },
        { column: "id", current: Prisma.sql`t.id`, direction: "desc" },
      ],
    );
    expect(sql.values).toEqual([1, "fixture-only"]);
    expect(sql.sql).toContain("COUNT(*) + 1");
    expect(sql.sql).toContain("rank_source.`name` <=> t.name");
    expect(sql.sql).toContain("rank_source.`name` IS NULL AND t.name IS NOT NULL");
    expect(sql.sql).toContain("rank_source.`id` > t.id");
    expect(sql.sql).not.toMatch(/\bOVER\s*\(|ROW_NUMBER|@[a-z]/i);
  });
  it("rejects missing ordering and unsafe identifiers", () => {
    expect(() => platformSqlRowNumber(Prisma.sql`SELECT id FROM templates`, [])).toThrow();
    expect(() =>
      platformSqlRowNumber(Prisma.sql`SELECT id FROM templates`, [
        { column: "id; SELECT 1", current: Prisma.sql`t.id`, direction: "desc" },
      ]),
    ).toThrow();
  });
});
