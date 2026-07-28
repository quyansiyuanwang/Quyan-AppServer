import { describe, expect, it } from "vitest";
import { toDatabaseDate } from "../../../src/util/database-date";

describe("toDatabaseDate", () => {
  it("uses the local calendar date at UTC midnight for @db.Date equality filters", () => {
    const value = new Date("2026-07-29T02:00:00+08:00");

    expect(toDatabaseDate(value).toISOString()).toBe("2026-07-29T00:00:00.000Z");
  });
});
