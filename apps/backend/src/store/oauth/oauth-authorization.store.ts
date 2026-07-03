import type {
  OAuthAccessToken,
  OAuthAuthorizationCode,
  OAuthClient,
  OAuthConsent,
  OAuthRefreshToken,
} from "@prisma/client";

export interface OAuthAuthorizationCodeCreateInput {
  oauthClientId: string;
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

export interface OAuthTokenPairCreateInput {
  oauthClientId: string;
  userId: string;
  accessTokenHash: string;
  accessTokenJti: string;
  accessTokenExpiresAt: Date;
  refreshTokenHash: string;
  refreshTokenExpiresAt: Date;
  scopes: string[];
}

export type OAuthAuthorizationCodeWithClient = OAuthAuthorizationCode & { oauthClient: OAuthClient };
export type OAuthAccessTokenWithClient = OAuthAccessToken & { oauthClient: OAuthClient };
export type OAuthRefreshTokenWithClient = OAuthRefreshToken & { oauthClient: OAuthClient };
export type OAuthConsentRecord = OAuthConsent;

export interface OAuthAuthorizationStore {
  findClientByClientId(clientId: string): Promise<OAuthClient | null>;
  findConsent(oauthClientId: string, userId: string): Promise<OAuthConsent | null>;
  upsertConsent(oauthClientId: string, userId: string, scopes: string[]): Promise<OAuthConsent>;
  touchConsent(id: string, lastUsedAt: Date): Promise<void>;
  createAuthorizationCode(data: OAuthAuthorizationCodeCreateInput): Promise<OAuthAuthorizationCode>;
  findAuthorizationCodeByHash(codeHash: string): Promise<OAuthAuthorizationCodeWithClient | null>;
  issueTokenPairFromAuthorizationCode(params: {
    authorizationCodeId: string;
    tokenPair: OAuthTokenPairCreateInput;
  }): Promise<void>;
  findAccessTokenByHash(tokenHash: string): Promise<OAuthAccessTokenWithClient | null>;
  touchAccessTokenLastUsed(id: string, lastUsedAt: Date): Promise<void>;
  findRefreshTokenByHash(tokenHash: string): Promise<OAuthRefreshTokenWithClient | null>;
  rotateRefreshToken(params: { refreshTokenId: string; tokenPair: OAuthTokenPairCreateInput }): Promise<void>;
  revokeTokenByHash(
    tokenHash: string,
    tokenTypeHint: "access_token" | "refresh_token" | undefined,
    oauthClientId: string,
  ): Promise<void>;
  touchClientLastUsed(id: string, lastUsedAt: Date): Promise<void>;
}
