import { Prisma } from "@prisma/client";
import { iamAccountDenied } from "../users/iam-account-principal";

export interface PlatformSqlRankColumn {
  column: string;
  current: Prisma.Sql;
  direction: "asc" | "desc";
}
/** MySQL 5.7-compatible rank over the complete filtered set, before scan cursors.
 * Nulls sort first in ASC and last in DESC, exactly as MySQL ORDER BY does.
 * The final unique ID key must be supplied by the caller to break all ties.
 */
export function platformSqlRowNumber(selection: Prisma.Sql, order: readonly PlatformSqlRankColumn[]): Prisma.Sql {
  if (!order.length) throw iamAccountDenied();
  const equal: Prisma.Sql[] = [];
  const preceding: Prisma.Sql[] = [];
  for (const key of order) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key.column) || !["asc", "desc"].includes(key.direction))
      throw iamAccountDenied();
    const candidate = Prisma.sql`rank_source.${Prisma.raw("`" + key.column + "`")}`;
    const before =
      key.direction === "asc"
        ? Prisma.sql`(${candidate} < ${key.current} OR (${candidate} IS NULL AND ${key.current} IS NOT NULL))`
        : Prisma.sql`(${candidate} > ${key.current} OR (${candidate} IS NOT NULL AND ${key.current} IS NULL))`;
    preceding.push(Prisma.sql`(${Prisma.join([...equal, before], " AND ")})`);
    equal.push(Prisma.sql`(${candidate} <=> ${key.current})`);
  }
  return Prisma.sql`(SELECT COUNT(*) + 1 FROM (${selection}) rank_source WHERE ${Prisma.join(preceding, " OR ")})`;
}
