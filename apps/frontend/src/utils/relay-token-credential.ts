/** Missing or redacted credentials must never become an empty clipboard entry or an import key. */
export function relayTokenCredential(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}
/** Batch copy is all-or-nothing; do not silently omit redacted tokens. */
export function collectRelayTokenCredentials(
  rows: readonly { token?: string }[],
): string[] | undefined {
  const values = rows.map((row) => relayTokenCredential(row.token))
  return values.length && values.every((value): value is string => value !== undefined)
    ? values
    : undefined
}
