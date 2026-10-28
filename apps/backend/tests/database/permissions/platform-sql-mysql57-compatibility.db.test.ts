import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { platformSqlRowNumber } from "@/store/system/platform-sql-row-number";

const input = [
  { id: "a", value: null },
  { id: "b", value: 2 },
  { id: "c", value: 1 },
  { id: "d", value: 2 },
  { id: "e", value: null },
];
const selection = Prisma.join(
  input.map((row) => Prisma.sql`SELECT CAST(${row.id} AS CHAR CHARACTER SET utf8mb4) AS id,${row.value} AS sortValue`),
  " UNION ALL ",
);
describe("MySQL 5.7-compatible authorization metadata", () => {
  it.each(["asc", "desc"] as const)("preserves %s null ordering, ties and pre-cursor ranks", async (direction) => {
    const rank = platformSqlRowNumber(selection, [
      { column: "sortValue", current: Prisma.sql`current_row.sortValue`, direction },
      { column: "id", current: Prisma.sql`current_row.id`, direction: "desc" },
    ]);
    const rows = await prisma.$queryRaw<{ id: string; displayOrder: bigint }[]>(Prisma.sql`
      SELECT current_row.id,${rank} AS displayOrder FROM (${selection}) current_row ORDER BY displayOrder`);
    expect(rows.map((row) => row.id)).toEqual(
      direction === "asc" ? ["e", "a", "c", "d", "b"] : ["d", "b", "c", "e", "a"],
    );
    expect(rows.map((row) => Number(row.displayOrder))).toEqual([1, 2, 3, 4, 5]);
    const page = await prisma.$queryRaw<{ id: string; displayOrder: bigint }[]>(Prisma.sql`
      SELECT current_row.id,${rank} AS displayOrder FROM (${selection}) current_row WHERE current_row.id IN ('a','c') ORDER BY displayOrder`);
    expect(page.map((row) => ({ id: row.id, displayOrder: Number(row.displayOrder) }))).toEqual(
      rows
        .filter((row) => ["a", "c"].includes(row.id))
        .map((row) => ({ id: row.id, displayOrder: Number(row.displayOrder) })),
    );
  });
  it("normalizes complete child snapshots independently of physical row order without string truncation", async () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      id: "child-" + index,
      value: "fixture-only-" + index + "x".repeat(2048),
    }));
    const hash = async (entries: typeof rows) => {
      const source = Prisma.join(
        entries.map((row) => Prisma.sql`SELECT ${row.id} AS id,${row.value} AS value`),
        " UNION ALL ",
      );
      const [result] = await prisma.$queryRaw<{ revision: string; bytes: bigint }[]>(Prisma.sql`
        SELECT SHA2(CAST(JSON_OBJECTAGG(id,JSON_ARRAY(value)) AS CHAR),256) AS revision,
        OCTET_LENGTH(CAST(JSON_OBJECTAGG(id,JSON_ARRAY(value)) AS CHAR)) AS bytes FROM (${source}) children`);
      expect(Number(result!.bytes)).toBeGreaterThan(65535);
      return result!.revision;
    };
    const before = await hash(rows);
    expect(await hash([...rows].reverse())).toBe(before);
    expect(
      await hash(rows.map((row, index) => (index === 31 ? { ...row, value: row.value + "changed" } : row))),
    ).not.toBe(before);
    expect(await hash(rows.slice(1))).not.toBe(before);
  });
});
