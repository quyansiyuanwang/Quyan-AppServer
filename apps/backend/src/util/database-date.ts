/**
 * Converts a local calendar date to a stable value for Prisma @db.Date columns.
 * A local midnight Date serializes to the previous UTC day in timezones east of
 * UTC, which makes equality filters miss the row they created.
 */
export function toDatabaseDate(value: Date = new Date()): Date {
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
}

/**
 * The value persisted by the former local-midnight implementation. It is only
 * used to migrate existing quota rows during the rollout of toDatabaseDate.
 */
export function toLegacyDatabaseDate(value: Date = new Date()): Date {
  const localMidnight = new Date(value);
  localMidnight.setHours(0, 0, 0, 0);
  return new Date(Date.UTC(localMidnight.getUTCFullYear(), localMidnight.getUTCMonth(), localMidnight.getUTCDate()));
}

/** Local midnight for a canonical @db.Date value (whose UTC fields encode the local calendar day).
 * A legacy bucket is eligible only if it was actually written during that local day;
 * yesterday's normalized bucket must never be migrated forward on every new day.
 */
export function localDayStartForDatabaseDate(value: Date): Date {
  return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}
