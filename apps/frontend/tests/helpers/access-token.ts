/**
 * Test-only JWT envelope matching JWTAccessIns.generateToken: claims are top-level.
 * Deliberately unsigned; never send these fixtures to a real backend.
 */
export const createAccessToken = (
  userId: string,
  updatedAt: string,
  claims: Record<string, unknown> = {},
): string =>
  [
    'test-header',
    Buffer.from(
      JSON.stringify({
        userId,
        updatedAt,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        ...claims,
      }),
    ).toString('base64url'),
    'test-only-not-a-valid-signature',
  ].join('.')
