import { describe, expect, it } from "vitest";
import { toDatabaseDate, toLegacyDatabaseDate, localDayStartForDatabaseDate } from "../../../src/util/database-date";

describe("toDatabaseDate", () => {
  it("uses the local calendar date at UTC midnight for @db.Date equality filters", () => {
    const value = new Date(2026, 6, 29, 2);

    expect(toDatabaseDate(value).toISOString()).toBe("2026-07-29T00:00:00.000Z");
  });

  it("identifies the date persisted by the prior local-midnight implementation", () => {
    const value = new Date(2026, 6, 29, 2);
    const legacyLocalMidnight = new Date(value);
    legacyLocalMidnight.setHours(0, 0, 0, 0);
    const expectedLegacyDate = new Date(
      Date.UTC(
        legacyLocalMidnight.getUTCFullYear(),
        legacyLocalMidnight.getUTCMonth(),
        legacyLocalMidnight.getUTCDate(),
      ),
    );

    expect(toLegacyDatabaseDate(value)).toEqual(expectedLegacyDate);
  });
});

describe("localDayStartForDatabaseDate", () => {
  it("interprets canonical UTC date fields as a local calendar date", () => {
    expect(localDayStartForDatabaseDate(new Date("2026-10-29T00:00:00Z"))).toEqual(new Date(2026, 9, 29));
  });
});
