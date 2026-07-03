import { createHash, randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcrypt";
import type { Request } from "express";
import type { OAuthClient } from "@prisma/client";
import type {
  OAuthAuthorizeDecisionDto,
  OAuthAuthorizeQueryDto,
  OAuthAuthorizationDecisionResponseDto,
  OAuthAuthorizationPreviewDto,
  OAuthTokenDto,
  OAuthTokenResponseDto,
} from "@/api/dto/oauth/oauth.dto";
import { OAuthAuthorizationRepository } from "@/store/oauth/oauth-authorization.repository";
import type { OAuthAuthorizationStore } from "@/store/oauth/oauth-authorization.store";
import { BadRequestError, NotFoundError } from "@/util/errors";

const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
const ACCESS_TOKEN_PREFIX = "oat_";
const REFRESH_TOKEN_PREFIX = "ort_";
const AUTHORIZATION_CODE_PREFIX = "oac_";
const APPROVED_REVIEW_STATUS = "approved";

export class OAuthProtocolError extends Error {
  public readonly statusCode: number;
  public readonly error: string;
  public readonly errorDescription: string;

  constructor(statusCode: number, error: string, errorDescription: string) {
    super(errorDescription);
    this.statusCode = statusCode;
    this.error = error;
    this.errorDescription = errorDescription;
  }
}

export class OAuthAuthorizationService {
  private static instance: OAuthAuthorizationService;

  constructor(private readonly repository: OAuthAuthorizationStore = OAuthAuthorizationRepository.getInstance()) {}

  static getInstance(): OAuthAuthorizationService {
    if (!this.instance) this.instance = new OAuthAuthorizationService();
    return this.instance;
  }

  async getAuthorizationPreview(userId: string, query: OAuthAuthorizeQueryDto): Promise<OAuthAuthorizationPreviewDto> {
    const client = await this.requireClient(query.client_id);
    this.validateAuthorizationRequest(client, query);

    const requestedScopes = this.parseScopes(query.scope, this.readJsonStringArray(client.scopes));
    const consent = await this.repository.findConsent(client.id, userId);
    const previouslyGrantedScopes = consent ? this.readJsonStringArray(consent.scopes) : [];
    const missingScopes = requestedScopes.filter((scope) => !previouslyGrantedScopes.includes(scope));

    return {
      client: {
        clientId: client.clientId,
        name: client.name,
        description: client.description ?? undefined,
        logoUrl: client.logoUrl ?? undefined,
        homepageUrl: client.homepageUrl ?? undefined,
        policyUrl: client.policyUrl ?? undefined,
        tosUrl: client.tosUrl ?? undefined,
      },
      requestedScopes,
      previouslyGrantedScopes,
      missingScopes,
      requireConsent: !consent || missingScopes.length > 0,
      redirectUri: query.redirect_uri,
      state: query.state?.trim() || undefined,
    };
  }

  async decideAuthorization(
    userId: string,
    body: OAuthAuthorizeDecisionDto,
  ): Promise<OAuthAuthorizationDecisionResponseDto> {
    const client = await this.requireClient(body.client_id);
    this.validateAuthorizationRequest(client, body);

    if (!body.approve)
      return {
        redirectTo: this.buildRedirect(body.redirect_uri, {
          error: "access_denied",
          error_description: "The resource owner denied the request",
          ...(body.state?.trim() ? { state: body.state.trim() } : {}),
        }),
      };

    const allowedScopes = this.readJsonStringArray(client.scopes);
    const requestedScopes = this.parseScopes(body.scope, allowedScopes);
    const consent = await this.repository.upsertConsent(client.id, userId, requestedScopes);

    const authorizationCode = this.generateOpaqueToken(AUTHORIZATION_CODE_PREFIX, 32);
    await this.repository.createAuthorizationCode({
      oauthClientId: client.id,
      userId,
      codeHash: this.hashOpaqueToken(authorizationCode),
      redirectUri: body.redirect_uri,
      scopes: requestedScopes,
      codeChallenge: body.code_challenge?.trim() || undefined,
      codeChallengeMethod: body.code_challenge
        ? ((body.code_challenge_method?.trim() as "S256" | "plain" | undefined) ?? "plain")
        : undefined,
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
      nonce: body.nonce?.trim() || undefined,
      state: body.state?.trim() || undefined,
    });

    await this.repository.touchConsent(consent.id, new Date());
    await this.repository.touchClientLastUsed(client.id, new Date());

    return {
      redirectTo: this.buildRedirect(body.redirect_uri, {
        code: authorizationCode,
        ...(body.state?.trim() ? { state: body.state.trim() } : {}),
      }),
    };
  }

  async exchangeToken(request: Request, body: OAuthTokenDto): Promise<OAuthTokenResponseDto> {
    if (body.grant_type === "authorization_code") return this.exchangeAuthorizationCode(request, body);
    if (body.grant_type === "refresh_token") return this.exchangeRefreshToken(request, body);

    throw new OAuthProtocolError(400, "unsupported_grant_type", "Unsupported grant_type");
  }

  async revokeToken(
    request: Request,
    body: {
      token: string;
      client_id?: string;
      client_secret?: string;
      token_type_hint?: "access_token" | "refresh_token";
    },
  ): Promise<void> {
    const client = await this.authenticateClient(request, {
      client_id: body.client_id,
      client_secret: body.client_secret,
    });

    await this.repository.revokeTokenByHash(this.hashOpaqueToken(body.token), body.token_type_hint, client.id);
  }

  private async exchangeAuthorizationCode(request: Request, body: OAuthTokenDto): Promise<OAuthTokenResponseDto> {
    const client = await this.authenticateClient(request, body);
    this.ensureGrantTypeEnabled(client, "authorization_code");

    const code = body.code?.trim();
    if (!code) throw new OAuthProtocolError(400, "invalid_request", "Missing authorization code");

    const redirectUri = body.redirect_uri?.trim();
    if (!redirectUri) throw new OAuthProtocolError(400, "invalid_request", "Missing redirect_uri");

    const authorizationCode = await this.repository.findAuthorizationCodeByHash(this.hashOpaqueToken(code));
    if (!authorizationCode) throw new OAuthProtocolError(400, "invalid_grant", "Authorization code is invalid");
    if (authorizationCode.oauthClientId !== client.id)
      throw new OAuthProtocolError(400, "invalid_grant", "Authorization code does not belong to this client");
    if (authorizationCode.redirectUri !== redirectUri)
      throw new OAuthProtocolError(400, "invalid_grant", "redirect_uri does not match authorization code");
    if (authorizationCode.usedAt)
      throw new OAuthProtocolError(400, "invalid_grant", "Authorization code has already been used");
    if (authorizationCode.expiresAt.getTime() <= Date.now())
      throw new OAuthProtocolError(400, "invalid_grant", "Authorization code has expired");

    this.validatePkce(
      client,
      authorizationCode.codeChallenge ?? undefined,
      authorizationCode.codeChallengeMethod ?? undefined,
      body.code_verifier,
    );

    const scopes = this.readJsonStringArray(authorizationCode.scopes);
    const tokenPair = this.buildTokenPair(client, authorizationCode.userId, scopes);
    await this.repository.issueTokenPairFromAuthorizationCode({
      authorizationCodeId: authorizationCode.id,
      tokenPair,
    });

    return this.toTokenResponse(tokenPair.accessToken, tokenPair.refreshToken, scopes, client.accessTokenLifetime);
  }

  private async exchangeRefreshToken(request: Request, body: OAuthTokenDto): Promise<OAuthTokenResponseDto> {
    const client = await this.authenticateClient(request, body);
    this.ensureGrantTypeEnabled(client, "refresh_token");

    const refreshToken = body.refresh_token?.trim();
    if (!refreshToken) throw new OAuthProtocolError(400, "invalid_request", "Missing refresh_token");

    const storedRefreshToken = await this.repository.findRefreshTokenByHash(this.hashOpaqueToken(refreshToken));
    if (!storedRefreshToken) throw new OAuthProtocolError(400, "invalid_grant", "Refresh token is invalid");
    if (storedRefreshToken.oauthClientId !== client.id)
      throw new OAuthProtocolError(400, "invalid_grant", "Refresh token does not belong to this client");
    if (storedRefreshToken.revokedAt)
      throw new OAuthProtocolError(400, "invalid_grant", "Refresh token has been revoked");
    if (storedRefreshToken.expiresAt.getTime() <= Date.now())
      throw new OAuthProtocolError(400, "invalid_grant", "Refresh token has expired");

    const consent = await this.repository.findConsent(client.id, storedRefreshToken.userId);
    const consentScopes = consent ? this.readJsonStringArray(consent.scopes) : this.readJsonStringArray(client.scopes);
    const scopes = consentScopes.filter((scope) => this.readJsonStringArray(client.scopes).includes(scope));
    const tokenPair = this.buildTokenPair(client, storedRefreshToken.userId, scopes);

    await this.repository.rotateRefreshToken({
      refreshTokenId: storedRefreshToken.id,
      tokenPair,
    });

    if (consent) await this.repository.touchConsent(consent.id, new Date());

    return this.toTokenResponse(tokenPair.accessToken, tokenPair.refreshToken, scopes, client.accessTokenLifetime);
  }

  private async authenticateClient(
    request: Request,
    body: Pick<OAuthTokenDto, "client_id" | "client_secret">,
  ): Promise<OAuthClient> {
    const authorization = String(request.headers.authorization || "").trim();
    let clientId = body.client_id?.trim();
    let clientSecret = body.client_secret?.trim();

    if (authorization.startsWith("Basic ")) {
      const encoded = authorization.slice(6).trim();
      try {
        const decoded = Buffer.from(encoded, "base64").toString("utf8");
        const separatorIndex = decoded.indexOf(":");
        if (separatorIndex >= 0) {
          clientId = decoded.slice(0, separatorIndex).trim() || clientId;
          clientSecret = decoded.slice(separatorIndex + 1).trim() || clientSecret;
        }
      } catch {
        throw new OAuthProtocolError(401, "invalid_client", "Client authentication failed");
      }
    }

    if (!clientId) throw new OAuthProtocolError(401, "invalid_client", "Missing client_id");

    const client = await this.repository.findClientByClientId(clientId);
    if (!client) throw new OAuthProtocolError(401, "invalid_client", "Client authentication failed");
    this.ensureClientApproved(client);

    if (client.clientType === "confidential") {
      if (!clientSecret || !client.clientSecretHash)
        throw new OAuthProtocolError(401, "invalid_client", "Client authentication failed");

      const matched = await bcrypt.compare(clientSecret, client.clientSecretHash);
      if (!matched) throw new OAuthProtocolError(401, "invalid_client", "Client authentication failed");
    }

    return client;
  }

  private async requireClient(clientId: string): Promise<OAuthClient> {
    const client = await this.repository.findClientByClientId(clientId.trim());
    if (!client) throw new NotFoundError("OAuth client not found");
    this.ensureClientApproved(client);
    return client;
  }

  private ensureClientApproved(client: OAuthClient): void {
    if (client.reviewStatus !== APPROVED_REVIEW_STATUS)
      throw new BadRequestError("OAuth client is not approved for authorization");
  }

  private validateAuthorizationRequest(client: OAuthClient, query: OAuthAuthorizeQueryDto): void {
    this.ensureGrantTypeEnabled(client, "authorization_code");

    const redirectUri = query.redirect_uri.trim();
    const allowedRedirectUris = this.readJsonStringArray(client.redirectUris);
    if (!allowedRedirectUris.includes(redirectUri)) throw new BadRequestError("Invalid redirect_uri");

    const allowedScopes = this.readJsonStringArray(client.scopes);
    this.parseScopes(query.scope, allowedScopes);

    if (client.isPkceRequired && !query.code_challenge?.trim())
      throw new BadRequestError("PKCE code_challenge is required");
    if (!query.code_challenge?.trim() && query.code_challenge_method)
      throw new BadRequestError("code_challenge_method requires code_challenge");
  }

  private ensureGrantTypeEnabled(client: OAuthClient, grantType: string): void {
    const grantTypes = this.readJsonStringArray(client.grantTypes);
    if (!grantTypes.includes(grantType))
      throw new OAuthProtocolError(400, "unsupported_grant_type", `Unsupported grant_type for client: ${grantType}`);
  }

  private validatePkce(
    client: OAuthClient,
    storedChallenge?: string,
    storedMethod?: string,
    codeVerifier?: string,
  ): void {
    if (!storedChallenge) {
      if (client.isPkceRequired) throw new OAuthProtocolError(400, "invalid_grant", "Missing PKCE challenge");
      return;
    }

    const verifier = codeVerifier?.trim();
    if (!verifier) throw new OAuthProtocolError(400, "invalid_request", "Missing code_verifier");

    const method = storedMethod === "S256" ? "S256" : "plain";
    const expected = method === "S256" ? this.base64UrlSha256(verifier) : verifier;

    if (!this.safeEqual(expected, storedChallenge))
      throw new OAuthProtocolError(400, "invalid_grant", "PKCE verification failed");
  }

  private buildTokenPair(client: OAuthClient, userId: string, scopes: string[]) {
    const accessToken = this.generateOpaqueToken(ACCESS_TOKEN_PREFIX, 32);
    const refreshToken = this.generateOpaqueToken(REFRESH_TOKEN_PREFIX, 32);
    const now = Date.now();

    return {
      accessToken,
      refreshToken,
      accessTokenHash: this.hashOpaqueToken(accessToken),
      refreshTokenHash: this.hashOpaqueToken(refreshToken),
      accessTokenJti: randomBytes(16).toString("hex"),
      oauthClientId: client.id,
      userId,
      accessTokenExpiresAt: new Date(now + client.accessTokenLifetime * 1000),
      refreshTokenExpiresAt: new Date(now + client.refreshTokenLifetime * 1000),
      scopes,
    };
  }

  private toTokenResponse(
    accessToken: string,
    refreshToken: string,
    scopes: string[],
    expiresIn: number,
  ): OAuthTokenResponseDto {
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    };
  }

  private parseScopes(rawScope: string | undefined, allowedScopes: string[]): string[] {
    if (!rawScope?.trim()) return [...allowedScopes];

    const requestedScopes = Array.from(
      new Set(
        rawScope
          .split(/\s+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );

    const normalizedScopes = requestedScopes.length > 0 ? requestedScopes : [];
    const invalidScope = normalizedScopes.find((scope) => !allowedScopes.includes(scope));
    if (invalidScope) throw new BadRequestError(`Invalid scope: ${invalidScope}`);

    return normalizedScopes;
  }

  private readJsonStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }

  private generateOpaqueToken(prefix: string, size: number): string {
    return `${prefix}${randomBytes(size).toString("hex")}`;
  }

  private hashOpaqueToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private base64UrlSha256(value: string): string {
    return createHash("sha256")
      .update(value)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private buildRedirect(baseUrl: string, params: Record<string, string>): string {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
  }
}
