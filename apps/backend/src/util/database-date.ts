/**
 * Converts a local calendar date to a stable value for Prisma @db.Date columns.
 * A local midnight Date serializes to the previous UTC day in timezones east of
 * UTC, which makes equality filters miss the row they created.
 */
export function toDatabaseDate(value: Date = new Date()): Date {
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
}
