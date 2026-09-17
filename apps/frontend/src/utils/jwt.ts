/**
 * Decode the standard JWT claims issued by backend JWTAccessIns.generateToken.
 * This is NOT signature verification or authorization: the server still validates
 * every authenticated request. Only identity scoping and refresh scheduling use it.
 */
export const parseJWT = (token: string): Record<string, unknown> | null => {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !parts[1]) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      Array.from(
        atob(base64),
        (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
      ).join(''),
    )
    const claims: unknown = JSON.parse(json)
    return claims !== null && typeof claims === 'object' && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
