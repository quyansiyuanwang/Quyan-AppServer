import { createHash, createPublicKey, randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcrypt";
import type { Request } from "express";
import { sign } from "jsonwebtoken";
import type { AuthCenterClient, User } from "@prisma/client";
import type {
  AuthCenterAuthorizeDecisionDto,
  AuthCenterAuthorizeQueryDto,
  AuthCenterAuthorizationDecisionResponseDto,
  AuthCenterAuthorizationPreviewDto,
  AuthCenterDiscoveryResponseDto,
  AuthCenterJwkDto,
  AuthCenterJwksResponseDto,
  AuthCenterTokenDto,
  AuthCenterTokenResponseDto,
} from "@/api/dto/auth-center/auth-center.dto";
import { env } from "@/config/env";
import { MANAGED_STATUS } from "@/constant/status";
import { AuthCenterAuthorizationRepository } from "@/store/auth-center/auth-center-authorization.repository";
import type {
  AuthCenterAuthorizationStore,
  AuthCenterTokenPairCreateInput,
} from "@/store/auth-center/auth-center-authorization.store";
import { UserRepository } from "@/store/users/user.repository";
import { validateAccountStatus } from "@/util/auth/account-status";
import { BadRequestError, NotFoundError } from "@/util/errors";

const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
const REFRESH_TOKEN_PREFIX = "acrt_";
const AUTHORIZATION_CODE_PREFIX = "acac_";
const APPROVED_REVIEW_STATUS = "approved";

export class AuthCenterProtocolError extends Error {
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

export class AuthCenterAuthorizationService {
  private static instance: AuthCenterAuthorizationService;

  constructor(
    private readonly repository: AuthCenterAuthorizationStore = AuthCenterAuthorizationRepository.getInstance(),
    private readonly userRepository: UserRepository = UserRepository.getInstance(),
  ) {}

  static getInstance(): AuthCenterAuthorizationService {
    if (!this.instance) this.instance = new AuthCenterAuthorizationService();
    return this.instance;
  }

  async getAuthorizationPreview(
    userId: string,
    query: AuthCenterAuthorizeQueryDto,
  ): Promise<AuthCenterAuthorizationPreviewDto> {
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
    body: AuthCenterAuthorizeDecisionDto,
  ): Promise<AuthCenterAuthorizationDecisionResponseDto> {
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
      authCenterClientId: client.id,
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

  async exchangeToken(request: Request, body: AuthCenterTokenDto): Promise<AuthCenterTokenResponseDto> {
    if (body.grant_type === "authorization_code") return this.exchangeAuthorizationCode(request, body);
    if (body.grant_type === "refresh_token") return this.exchangeRefreshToken(request, body);
    if (body.grant_type === "client_credentials") return this.exchangeClientCredentials(request, body);

    throw new AuthCenterProtocolError(400, "unsupported_grant_type", "Unsupported grant_type");
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

  getJwks(): AuthCenterJwksResponseDto {
    const publicJwk = createPublicKey(env.auth.authCenter.publicKey).export({ format: "jwk" }) as Record<
      string,
      unknown
    >;

    return {
      keys: [
        {
          ...publicJwk,
          kid: env.auth.authCenter.keyId,
          use: "sig",
          alg: env.auth.authCenter.algorithm,
        } as AuthCenterJwkDto,
      ],
    };
  }

  getDiscoveryDocument(): AuthCenterDiscoveryResponseDto {
    const issuer = env.auth.authCenter.issuer.replace(/\/$/, "");
    return {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
      scopes_supported: ["profile"],
      code_challenge_methods_supported: ["S256", "plain"],
    };
  }

  private async exchangeAuthorizationCode(
    request: Request,
    body: AuthCenterTokenDto,
  ): Promise<AuthCenterTokenResponseDto> {
    const client = await this.authenticateClient(request, body);
    this.ensureGrantTypeEnabled(client, "authorization_code");

    const code = body.code?.trim();
    if (!code) throw new AuthCenterProtocolError(400, "invalid_request", "Missing authorization code");

    const redirectUri = body.redirect_uri?.trim();
    if (!redirectUri) throw new AuthCenterProtocolError(400, "invalid_request", "Missing redirect_uri");

    const authorizationCode = await this.repository.findAuthorizationCodeByHash(this.hashOpaqueToken(code));
    if (!authorizationCode) throw new AuthCenterProtocolError(400, "invalid_grant", "Authorization code is invalid");
    if (authorizationCode.authCenterClientId !== client.id)
      throw new AuthCenterProtocolError(400, "invalid_grant", "Authorization code does not belong to this client");
    if (authorizationCode.redirectUri !== redirectUri)
      throw new AuthCenterProtocolError(400, "invalid_grant", "redirect_uri does not match authorization code");
    if (authorizationCode.usedAt)
      throw new AuthCenterProtocolError(400, "invalid_grant", "Authorization code has already been used");
    if (authorizationCode.expiresAt.getTime() <= Date.now())
      throw new AuthCenterProtocolError(400, "invalid_grant", "Authorization code has expired");

    this.validatePkce(
      client,
      authorizationCode.codeChallenge ?? undefined,
      authorizationCode.codeChallengeMethod ?? undefined,
      body.code_verifier,
    );

    await this.ensureUserEligible(authorizationCode.userId);

    const scopes = this.readJsonStringArray(authorizationCode.scopes);
    const tokenPair = this.buildTokenPair({
      client,
      userId: authorizationCode.userId,
      subject: authorizationCode.userId,
      scopes,
      grantType: "authorization_code",
      includeRefreshToken: this.readJsonStringArray(client.grantTypes).includes("refresh_token"),
    });

    await this.repository.issueTokenPairFromAuthorizationCode({
      authorizationCodeId: authorizationCode.id,
      tokenPair,
    });

    return this.toTokenResponse(tokenPair.accessToken, tokenPair.refreshToken, scopes, client.accessTokenLifetime);
  }

  private async exchangeRefreshToken(request: Request, body: AuthCenterTokenDto): Promise<AuthCenterTokenResponseDto> {
    const client = await this.authenticateClient(request, body);
    this.ensureGrantTypeEnabled(client, "refresh_token");

    const refreshToken = body.refresh_token?.trim();
    if (!refreshToken) throw new AuthCenterProtocolError(400, "invalid_request", "Missing refresh_token");

    const storedRefreshToken = await this.repository.findRefreshTokenByHash(this.hashOpaqueToken(refreshToken));
    if (!storedRefreshToken) throw new AuthCenterProtocolError(400, "invalid_grant", "Refresh token is invalid");
    if (storedRefreshToken.authCenterClientId !== client.id)
      throw new AuthCenterProtocolError(400, "invalid_grant", "Refresh token does not belong to this client");
    if (storedRefreshToken.revokedAt)
      throw new AuthCenterProtocolError(400, "invalid_grant", "Refresh token has been revoked");
    if (storedRefreshToken.expiresAt.getTime() <= Date.now())
      throw new AuthCenterProtocolError(400, "invalid_grant", "Refresh token has expired");

    await this.ensureUserEligible(storedRefreshToken.userId);

    const consent = await this.repository.findConsent(client.id, storedRefreshToken.userId);
    const consentScopes = consent ? this.readJsonStringArray(consent.scopes) : this.readJsonStringArray(client.scopes);
    const scopes = consentScopes.filter((scope) => this.readJsonStringArray(client.scopes).includes(scope));
    const tokenPair = this.buildTokenPair({
      client,
      userId: storedRefreshToken.userId,
      subject: storedRefreshToken.userId,
      scopes,
      grantType: "refresh_token",
      includeRefreshToken: true,
    });

    await this.repository.rotateRefreshToken({
      refreshTokenId: storedRefreshToken.id,
      tokenPair,
    });

    if (consent) await this.repository.touchConsent(consent.id, new Date());

    return this.toTokenResponse(tokenPair.accessToken, tokenPair.refreshToken, scopes, client.accessTokenLifetime);
  }

  private async exchangeClientCredentials(
    request: Request,
    body: AuthCenterTokenDto,
  ): Promise<AuthCenterTokenResponseDto> {
    const client = await this.authenticateClient(request, body);
    this.ensureGrantTypeEnabled(client, "client_credentials");

    if (client.clientType !== "confidential")
      throw new AuthCenterProtocolError(401, "invalid_client", "Client authentication failed");

    const scopes = this.parseScopes(body.scope, this.readJsonStringArray(client.scopes));
    const tokenPair = this.buildTokenPair({
      client,
      subject: client.clientId,
      scopes,
      grantType: "client_credentials",
      includeRefreshToken: false,
    });

    await this.repository.issueClientCredentialsAccessToken(tokenPair);

    return this.toTokenResponse(tokenPair.accessToken, undefined, scopes, client.accessTokenLifetime);
  }

  private async authenticateClient(
    request: Request,
    body: Pick<AuthCenterTokenDto, "client_id" | "client_secret">,
  ): Promise<AuthCenterClient> {
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
        throw new AuthCenterProtocolError(401, "invalid_client", "Client authentication failed");
      }
    }

    if (!clientId) throw new AuthCenterProtocolError(401, "invalid_client", "Missing client_id");

    const client = await this.repository.findClientByClientId(clientId);
    if (!client) throw new AuthCenterProtocolError(401, "invalid_client", "Client authentication failed");
    this.ensureClientApproved(client);

    if (client.clientType === "confidential") {
      if (!clientSecret || !client.clientSecretHash)
        throw new AuthCenterProtocolError(401, "invalid_client", "Client authentication failed");

      const matched = await bcrypt.compare(clientSecret, client.clientSecretHash);
      if (!matched) throw new AuthCenterProtocolError(401, "invalid_client", "Client authentication failed");
    }

    return client;
  }

  private async requireClient(clientId: string): Promise<AuthCenterClient> {
    const client = await this.repository.findClientByClientId(clientId.trim());
    if (!client) throw new NotFoundError("Auth Center client not found");
    this.ensureClientApproved(client);
    return client;
  }

  private ensureClientApproved(client: AuthCenterClient): void {
    if (client.status !== MANAGED_STATUS.ENABLED) throw new BadRequestError("Auth Center client is disabled");
    if (client.reviewStatus !== APPROVED_REVIEW_STATUS)
      throw new BadRequestError("Auth Center client is not approved for authorization");
  }

  private async ensureUserEligible(userId: string): Promise<User> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new AuthCenterProtocolError(400, "invalid_grant", "User does not exist");

    try {
      validateAccountStatus(user.status, user.id, "auth_center_token_exchange");
      return user;
    } catch {
      throw new AuthCenterProtocolError(400, "invalid_grant", "User account is not available");
    }
  }

  private validateAuthorizationRequest(client: AuthCenterClient, query: AuthCenterAuthorizeQueryDto): void {
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

  private ensureGrantTypeEnabled(client: AuthCenterClient, grantType: string): void {
    const grantTypes = this.readJsonStringArray(client.grantTypes);
    if (!grantTypes.includes(grantType))
      throw new AuthCenterProtocolError(
        400,
        "unsupported_grant_type",
        `Unsupported grant_type for client: ${grantType}`,
      );
  }

  private validatePkce(
    client: AuthCenterClient,
    storedChallenge?: string,
    storedMethod?: string,
    codeVerifier?: string,
  ): void {
    if (!storedChallenge) {
      if (client.isPkceRequired) throw new AuthCenterProtocolError(400, "invalid_grant", "Missing PKCE challenge");
      return;
    }

    const verifier = codeVerifier?.trim();
    if (!verifier) throw new AuthCenterProtocolError(400, "invalid_request", "Missing code_verifier");

    const method = storedMethod === "S256" ? "S256" : "plain";
    const expected = method === "S256" ? this.base64UrlSha256(verifier) : verifier;

    if (!this.safeEqual(expected, storedChallenge))
      throw new AuthCenterProtocolError(400, "invalid_grant", "PKCE verification failed");
  }

  private buildTokenPair(input: {
    client: AuthCenterClient;
    subject: string;
    scopes: string[];
    grantType: "authorization_code" | "refresh_token" | "client_credentials";
    userId?: string;
    includeRefreshToken: boolean;
  }): AuthCenterTokenPairCreateInput & { accessToken: string; refreshToken?: string } {
    const jti = randomBytes(16).toString("hex");
    const now = Date.now();
    const accessTokenExpiresAt = new Date(now + input.client.accessTokenLifetime * 1000);
    const accessToken = sign(
      {
        scope: input.scopes.join(" "),
        client_id: input.client.clientId,
        grant_type: input.grantType,
        token_use: "access_token",
        ...(input.userId ? { uid: input.userId } : {}),
      },
      env.auth.authCenter.privateKey,
      {
        algorithm: env.auth.authCenter.algorithm,
        keyid: env.auth.authCenter.keyId,
        issuer: env.auth.authCenter.issuer,
        audience: input.client.clientId,
        subject: input.subject,
        jwtid: jti,
        expiresIn: input.client.accessTokenLifetime,
      },
    );

    const refreshToken = input.includeRefreshToken ? this.generateOpaqueToken(REFRESH_TOKEN_PREFIX, 32) : undefined;

    return {
      accessToken,
      refreshToken,
      authCenterClientId: input.client.id,
      userId: input.userId,
      subject: input.subject,
      accessTokenHash: this.hashOpaqueToken(accessToken),
      accessTokenJti: jti,
      accessTokenExpiresAt,
      refreshTokenHash: refreshToken ? this.hashOpaqueToken(refreshToken) : undefined,
      refreshTokenExpiresAt: refreshToken ? new Date(now + input.client.refreshTokenLifetime * 1000) : undefined,
      scopes: input.scopes,
    };
  }

  private toTokenResponse(
    accessToken: string,
    refreshToken: string | undefined,
    scopes: string[],
    expiresIn: number,
  ): AuthCenterTokenResponseDto {
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
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

    const invalidScope = requestedScopes.find((scope) => !allowedScopes.includes(scope));
    if (invalidScope) throw new BadRequestError(`Invalid scope: ${invalidScope}`);

    return requestedScopes;
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
