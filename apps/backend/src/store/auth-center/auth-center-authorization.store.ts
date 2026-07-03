import type {
  AuthCenterAccessToken,
  AuthCenterAuthorizationCode,
  AuthCenterClient,
  AuthCenterConsent,
  AuthCenterRefreshToken,
} from "@prisma/client";

export interface AuthCenterAuthorizationCodeCreateInput {
  authCenterClientId: string;
  userId: string;
  codeHash: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge?: string;
  codeChallengeMethod?: "S256" | "plain";
  expiresAt: Date;
  nonce?: string;
  state?: string;
}

export interface AuthCenterTokenPairCreateInput {
  authCenterClientId: string;
  userId?: string;
  subject: string;
  accessTokenHash: string;
  accessTokenJti: string;
  accessTokenExpiresAt: Date;
  refreshTokenHash?: string;
  refreshTokenExpiresAt?: Date;
  scopes: string[];
}

export type AuthCenterAuthorizationCodeWithClient = AuthCenterAuthorizationCode & {
  authCenterClient: AuthCenterClient;
};
export type AuthCenterRefreshTokenWithClient = AuthCenterRefreshToken & { authCenterClient: AuthCenterClient };
export type AuthCenterConsentRecord = AuthCenterConsent;

export interface AuthCenterAuthorizationStore {
  findClientByClientId(clientId: string): Promise<AuthCenterClient | null>;
  findConsent(authCenterClientId: string, userId: string): Promise<AuthCenterConsent | null>;
  upsertConsent(authCenterClientId: string, userId: string, scopes: string[]): Promise<AuthCenterConsent>;
  touchConsent(id: string, lastUsedAt: Date): Promise<void>;
  createAuthorizationCode(data: AuthCenterAuthorizationCodeCreateInput): Promise<AuthCenterAuthorizationCode>;
  findAuthorizationCodeByHash(codeHash: string): Promise<AuthCenterAuthorizationCodeWithClient | null>;
  issueTokenPairFromAuthorizationCode(params: {
    authorizationCodeId: string;
    tokenPair: AuthCenterTokenPairCreateInput;
  }): Promise<void>;
  issueClientCredentialsAccessToken(tokenPair: AuthCenterTokenPairCreateInput): Promise<void>;
  findRefreshTokenByHash(tokenHash: string): Promise<AuthCenterRefreshTokenWithClient | null>;
  rotateRefreshToken(params: { refreshTokenId: string; tokenPair: AuthCenterTokenPairCreateInput }): Promise<void>;
  revokeTokenByHash(
    tokenHash: string,
    tokenTypeHint: "access_token" | "refresh_token" | undefined,
    authCenterClientId: string,
  ): Promise<void>;
  touchClientLastUsed(id: string, lastUsedAt: Date): Promise<void>;
}
