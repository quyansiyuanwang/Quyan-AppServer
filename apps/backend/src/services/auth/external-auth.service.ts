import axios from "axios";
import QRCode from "qrcode";
import { createHash, randomUUID } from "crypto";
import type { Request, Response } from "express";
import type { UserExternalIdentity } from "@prisma/client";
import { env } from "@/config/env";
import { RedisService } from "@/services/infrastructure/redis.service";
import { UserRepository } from "@/store/users/user.repository";
import { ExternalIdentityRepository } from "@/store/auth/external-identity.repository";
import type { UserStore } from "@/store/users/user.store";
import type { ExternalIdentityStore } from "@/store/auth/external-identity.store";
import { AuthService } from "@/services/auth/auth.service";
import { ConfigService, type SocialAuthConfig } from "@/services/system/config.service";
import { IpGeolocationService } from "@/services/infrastructure/ip-geolocation.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { CustomCode } from "@/constant/custom-code";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  GatewayTimeoutError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "@/util/errors";
import { JWTAccessIns } from "@/util/auth";
import { SSEStreamService } from "@/util/streaming/sse";
import { extractClientIp } from "@/util/ip-extractor";
import type {
  BindExternalIdentityResponse,
  CreateQrLoginSessionResponse,
  ExternalAuthAction,
  ExternalAuthBindingRequiredData,
  ExternalAuthCallbackResponse,
  ExternalAuthProvider,
  ExternalIdentityItem,
  ExternalIdentityProfile,
  ListExternalIdentitiesResponse,
  QrLoginSessionContextDto,
  QrLoginSessionStatusResponse,
  StartExternalAuthResponse,
  UnbindExternalIdentityResponse,
} from "@/api/dto/auth/auth.dto";

interface AuthenticatedRequest {
  user?: {
    userId: string;
    [key: string]: any;
  };
}

interface ExternalAuthStatePayload {
  provider: ExternalAuthProvider;
  action: ExternalAuthAction;
  redirectUri?: string;
  userId?: string;
}

interface ExternalBindingPayload {
  provider: ExternalAuthProvider;
  profile: ExternalIdentityProfile;
}

interface QrLoginSessionPayload {
  sessionId: string;
  status: "pending" | "scanned" | "approved" | "rejected" | "consumed" | "expired";
  createdAt: string;
  approvedByUserId?: string;
  requestIp?: string;
  requestLocation?: string;
  requestUserAgent?: string;
  deviceSummary?: string;
}

interface ExternalProviderProfile extends ExternalIdentityProfile {
  accessToken?: string | null;
  refreshToken?: string | null;
  scope?: string | null;
  raw: Record<string, unknown>;
}

type NetworkRetryOptions = {
  retries?: number;
  timeoutMs?: number;
  label: string;
};

export class ExternalAuthService {
  private static instance: ExternalAuthService;

  private constructor(
    private readonly redisService: RedisService = RedisService.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly externalIdentityRepository: ExternalIdentityStore = ExternalIdentityRepository.getInstance(),
    private readonly authService: AuthService = new AuthService(),
    private readonly configService: ConfigService = ConfigService.getInstance(),
    private readonly ipGeolocationService: IpGeolocationService = IpGeolocationService.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly sseService: SSEStreamService = SSEStreamService.getInstance(),
  ) {}

  public static getInstance(): ExternalAuthService {
    if (!ExternalAuthService.instance) ExternalAuthService.instance = new ExternalAuthService();
    return ExternalAuthService.instance;
  }

  private externalStateKey(state: string): string {
    return `auth:external:state:${state}`;
  }

  private bindingTokenKey(token: string): string {
    return `auth:external:binding:${token}`;
  }

  private qrLoginKey(sessionId: string): string {
    return `auth:qr-login:${sessionId}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getNormalizedUserAgent(userAgent: string | string[] | undefined): string | undefined {
    if (Array.isArray(userAgent)) return userAgent[0] || undefined;
    return userAgent || undefined;
  }

  private summarizeDevice(userAgent: string | undefined): string | undefined {
    const normalized = String(userAgent || "").trim();
    if (!normalized) return undefined;

    const parts: string[] = [];
    if (/Windows/i.test(normalized)) parts.push("Windows");
    else if (/Android/i.test(normalized)) parts.push("Android");
    else if (/(iPhone|iPad|iOS)/i.test(normalized)) parts.push("iOS");
    else if (/Mac OS X|Macintosh/i.test(normalized)) parts.push("macOS");
    else if (/Linux/i.test(normalized)) parts.push("Linux");

    if (/Edg\//i.test(normalized)) parts.push("Edge");
    else if (/Chrome\//i.test(normalized)) parts.push("Chrome");
    else if (/Firefox\//i.test(normalized)) parts.push("Firefox");
    else if (/Safari\//i.test(normalized) && !/Chrome\//i.test(normalized)) parts.push("Safari");

    return parts.length > 0 ? parts.join(" · ") : normalized.slice(0, 120);
  }

  private async buildQrLoginSessionContext(
    sessionId: string,
    payload: QrLoginSessionPayload,
    expiresIn: number,
  ): Promise<QrLoginSessionContextDto> {
    const user = payload.approvedByUserId ? await this.userRepository.findById(payload.approvedByUserId) : null;

    return {
      sessionId,
      status: payload.status,
      expiresIn,
      createdAt: payload.createdAt,
      requestIp: payload.requestIp,
      requestLocation: payload.requestLocation,
      requestUserAgent: payload.requestUserAgent,
      deviceSummary: payload.deviceSummary,
      user: this.mapQrUser(user),
    };
  }

  private getProviderConfig(provider: ExternalAuthProvider, config: SocialAuthConfig) {
    switch (provider) {
      case "github":
        return config.github;
      case "wechat-open":
        return config.wechatOpen;
      case "wechat-web":
        return config.wechatWeb;
      default:
        throw new BadRequestError("不支持的外部登录提供方", CustomCode.EXTERNAL_AUTH_CALLBACK_INVALID);
    }
  }

  private assertProviderEnabled(provider: ExternalAuthProvider, config: SocialAuthConfig): void {
    const providerConfig = this.getProviderConfig(provider, config);
    if (!providerConfig.enabled)
      throw new BadRequestError("当前外部登录方式未启用", CustomCode.EXTERNAL_AUTH_PROVIDER_DISABLED);
  }

  private getBackendOrigin(request?: Request): string {
    const host = String(request?.headers.host || "").trim();
    const protoHeader = String(request?.headers["x-forwarded-proto"] || "").trim();
    const protocol = protoHeader || (request?.secure ? "https" : "http");

    if (host) return `${protocol}://${host}`;
    return `http://localhost:${env.runtime.port}`;
  }

  private getFrontendOrigin(config: SocialAuthConfig, request?: Request): string {
    const configured = String(config.frontendBaseUrl || "")
      .trim()
      .replace(/\/+$/, "");
    return configured || this.getBackendOrigin(request);
  }

  private extractBearerToken(request?: Request): string | undefined {
    const authHeader = request?.headers["authorization"];
    if (typeof authHeader !== "string") return undefined;

    const normalized = authHeader.trim();
    if (!normalized) return undefined;
    if (!/^Bearer\s+/i.test(normalized)) return undefined;

    const token = normalized.replace(/^Bearer\s+/i, "").trim();
    return token || undefined;
  }

  private async resolveAuthenticatedUserId(request?: Request): Promise<string | undefined> {
    const typedReq = request as AuthenticatedRequest | undefined;
    if (typedReq?.user?.userId) return typedReq.user.userId;

    const bearerToken = this.extractBearerToken(request);
    if (!bearerToken) return undefined;

    const payload = await JWTAccessIns.verifyToken(bearerToken).catch(() => null);
    return payload?.userId || undefined;
  }

  private buildCallbackUrl(
    provider: ExternalAuthProvider,
    config: SocialAuthConfig,
    request?: Request,
    options?: {
      action?: ExternalAuthAction;
      redirectUri?: string;
    },
  ): string {
    const providerConfig = this.getProviderConfig(provider, config);
    const normalizedRedirect = String(options?.redirectUri || "").trim();

    if (options?.action === "bind" && normalizedRedirect) {
      const authOrigin = this.getFrontendOrigin(config, request);
      const callbackUrl = new URL(normalizedRedirect, authOrigin);
      if (callbackUrl.origin !== new URL(authOrigin).origin)
        throw new BadRequestError("External account binding callback must use the central auth origin");
      return callbackUrl.toString();
    }

    const configuredCallbackPath = String(providerConfig.callbackPath || "").trim();
    const legacyBackendCallbackPath = `/v1/auth/external/${provider}/callback`;
    const effectiveCallbackPath =
      !configuredCallbackPath || configuredCallbackPath === legacyBackendCallbackPath
        ? `/auth/external/${provider}/callback`
        : configuredCallbackPath;

    const callbackUrl = /^https?:\/\//i.test(effectiveCallbackPath)
      ? new URL(effectiveCallbackPath)
      : new URL(
          effectiveCallbackPath,
          effectiveCallbackPath.startsWith("/v1/")
            ? this.getBackendOrigin(request)
            : this.getFrontendOrigin(config, request),
        );

    if (options?.action !== "bind" && normalizedRedirect) {
      callbackUrl.searchParams.set("redirect", normalizedRedirect);
    }

    return callbackUrl.toString();
  }

  private async persistExternalState(payload: ExternalAuthStatePayload): Promise<string> {
    const state = randomUUID();
    const socialConfig = await this.configService.getSocialAuthConfig();
    await this.redisService.set(this.externalStateKey(state), JSON.stringify(payload), socialConfig.stateTtlSeconds);
    return state;
  }

  private async readExternalState(state: string): Promise<ExternalAuthStatePayload> {
    const key = this.externalStateKey(state);
    const raw = await this.redisService.get(key);
    if (!raw) throw new UnauthorizedError("外部登录状态已失效，请重试", CustomCode.EXTERNAL_AUTH_STATE_INVALID);

    try {
      return JSON.parse(raw) as ExternalAuthStatePayload;
    } catch {
      throw new UnauthorizedError("外部登录状态无效，请重试", CustomCode.EXTERNAL_AUTH_STATE_INVALID);
    }
  }

  private async peekExternalState(state: string): Promise<ExternalAuthStatePayload> {
    return this.readExternalState(state);
  }

  private async consumeExternalState(state: string): Promise<ExternalAuthStatePayload> {
    const payload = await this.readExternalState(state);
    await this.redisService.delete(this.externalStateKey(state));
    return payload;
  }

  private async withTimeoutAndRetry<T>(operation: () => Promise<T>, options: NetworkRetryOptions): Promise<T> {
    const retries = Math.max(0, Math.floor(options.retries ?? 0));
    const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 15_000));

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const shouldRetry = attempt < retries && this.isRetryableNetworkError(error);
        if (!shouldRetry) break;
      } finally {
        clearTimeout(timer);
      }
    }

    if (lastError instanceof GatewayTimeoutError) throw lastError;
    throw this.normalizeNetworkError(lastError, options.label);
  }

  private isRetryableNetworkError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;

    const anyError = error as {
      code?: string;
      message?: string;
      name?: string;
      response?: { status?: number };
      cause?: { code?: string };
    };

    const status = anyError.response?.status;
    if (typeof status === "number" && status >= 500) return true;

    const code = anyError.code || anyError.cause?.code;
    if (["ECONNABORTED", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN", "ECONNRESET", "EPIPE"].includes(code || ""))
      return true;

    const name = String(anyError.name || "").toLowerCase();
    if (name.includes("abort")) return true;

    const message = String(anyError.message || "").toLowerCase();
    return message.includes("timeout") || message.includes("socket hang up");
  }

  private normalizeNetworkError(error: unknown, label: string): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 504 || status === 408 || error.code === "ECONNABORTED") {
        throw new GatewayTimeoutError(`${label} 请求超时，请稍后重试`);
      }
      if (status && status >= 500) {
        throw new GatewayTimeoutError(`${label} 上游暂时不可用，请稍后重试`);
      }
    }

    throw new GatewayTimeoutError(`${label} 暂时不可用，请稍后重试`);
  }

  private async createBindingToken(payload: ExternalBindingPayload): Promise<{ token: string; expiresIn: number }> {
    const token = randomUUID();
    const socialConfig = await this.configService.getSocialAuthConfig();
    const expiresIn = socialConfig.stateTtlSeconds;
    await this.redisService.set(this.bindingTokenKey(token), JSON.stringify(payload), expiresIn);
    return { token, expiresIn };
  }

  private async consumeBindingToken(token: string): Promise<ExternalBindingPayload> {
    const key = this.bindingTokenKey(token);
    const raw = await this.redisService.get(key);
    if (!raw) throw new UnauthorizedError("外部绑定会话已失效，请重试", CustomCode.EXTERNAL_AUTH_STATE_INVALID);

    await this.redisService.delete(key);

    try {
      return JSON.parse(raw) as ExternalBindingPayload;
    } catch {
      throw new UnauthorizedError("外部绑定会话无效，请重试", CustomCode.EXTERNAL_AUTH_STATE_INVALID);
    }
  }

  private mapIdentityItem(identity: {
    id: string;
    provider: string;
    providerUserId: string;
    providerUnionId: string | null;
    providerUsername: string | null;
    providerEmail: string | null;
    avatarUrl: string | null;
    linkedAt: Date;
    lastLoginAt: Date | null;
    lastSyncedAt: Date | null;
  }): ExternalIdentityItem {
    return {
      id: identity.id,
      provider: identity.provider as ExternalAuthProvider,
      providerUserId: identity.providerUserId,
      providerUnionId: identity.providerUnionId,
      providerUsername: identity.providerUsername,
      providerEmail: identity.providerEmail,
      avatarUrl: identity.avatarUrl,
      linkedAt: identity.linkedAt.toISOString(),
      lastLoginAt: identity.lastLoginAt?.toISOString() ?? null,
      lastSyncedAt: identity.lastSyncedAt?.toISOString() ?? null,
    };
  }

  private async fetchGithubProfile(
    code: string,
    request?: Request,
    callbackUrl?: string,
  ): Promise<ExternalProviderProfile> {
    const socialConfig = await this.configService.getSocialAuthConfig();
    const config = socialConfig.github;

    const tokenResponse = await this.withTimeoutAndRetry(
      async () =>
        axios.post(
          config.tokenUrl,
          {
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: callbackUrl || this.buildCallbackUrl("github", socialConfig, request),
          },
          {
            headers: {
              Accept: "application/json",
            },
          },
        ),
      {
        label: "GitHub token",
        retries: 1,
        timeoutMs: 15_000,
      },
    );

    const accessToken = String(tokenResponse.data?.access_token || "").trim();
    if (!accessToken) throw new UnauthorizedError("GitHub 登录令牌获取失败", CustomCode.EXTERNAL_AUTH_CALLBACK_INVALID);

    const [profileResponse, emailResponse] = await Promise.all([
      this.withTimeoutAndRetry(
        async () =>
          axios.get(config.userUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
          }),
        {
          label: "GitHub user",
          retries: 1,
          timeoutMs: 15_000,
        },
      ),
      this.withTimeoutAndRetry(
        async () =>
          axios.get(config.emailUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
          }),
        {
          label: "GitHub email",
          retries: 1,
          timeoutMs: 15_000,
        },
      ),
    ]);

    const primaryEmail = Array.isArray(emailResponse.data)
      ? emailResponse.data.find((item: any) => item?.primary)?.email || emailResponse.data[0]?.email
      : undefined;

    return {
      provider: "github",
      providerUserId: String(profileResponse.data?.id || ""),
      providerUsername: profileResponse.data?.login ? String(profileResponse.data.login) : null,
      providerEmail: primaryEmail ? String(primaryEmail) : null,
      avatarUrl: profileResponse.data?.avatar_url ? String(profileResponse.data.avatar_url) : null,
      providerUnionId: null,
      accessToken,
      scope: tokenResponse.data?.scope ? String(tokenResponse.data.scope) : config.scope,
      raw: {
        profile: profileResponse.data,
        emails: emailResponse.data,
      },
    };
  }

  private async fetchWechatProfile(
    provider: Extract<ExternalAuthProvider, "wechat-open" | "wechat-web">,
    code: string,
    request?: Request,
    callbackUrl?: string,
  ): Promise<ExternalProviderProfile> {
    const socialConfig = await this.configService.getSocialAuthConfig();
    const config = provider === "wechat-open" ? socialConfig.wechatOpen : socialConfig.wechatWeb;

    const tokenResponse = await axios.get(config.tokenUrl, {
      params: {
        appid: config.appId,
        secret: config.appSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl || this.buildCallbackUrl(provider, socialConfig, request),
      },
    });

    const accessToken = String(tokenResponse.data?.access_token || "").trim();
    const openId = String(tokenResponse.data?.openid || "").trim();

    if (!accessToken || !openId)
      throw new UnauthorizedError("微信登录令牌获取失败", CustomCode.EXTERNAL_AUTH_CALLBACK_INVALID);

    const profileResponse = await axios.get(config.userUrl, {
      params: {
        access_token: accessToken,
        openid: openId,
        lang: "zh_CN",
      },
    });

    return {
      provider,
      providerUserId: openId,
      providerUnionId: profileResponse.data?.unionid ? String(profileResponse.data.unionid) : null,
      providerUsername: profileResponse.data?.nickname ? String(profileResponse.data.nickname) : null,
      providerEmail: null,
      avatarUrl: profileResponse.data?.headimgurl ? String(profileResponse.data.headimgurl) : null,
      accessToken,
      refreshToken: tokenResponse.data?.refresh_token ? String(tokenResponse.data.refresh_token) : null,
      scope: tokenResponse.data?.scope ? String(tokenResponse.data.scope) : config.scope,
      raw: {
        token: tokenResponse.data,
        profile: profileResponse.data,
      },
    };
  }

  private async fetchProviderProfile(
    provider: ExternalAuthProvider,
    code: string,
    request?: Request,
    callbackUrl?: string,
  ): Promise<ExternalProviderProfile> {
    if (provider === "github") return this.fetchGithubProfile(code, request, callbackUrl);
    if (provider === "wechat-open" || provider === "wechat-web")
      return this.fetchWechatProfile(provider, code, request, callbackUrl);
    throw new BadRequestError("不支持的外部登录提供方", CustomCode.EXTERNAL_AUTH_CALLBACK_INVALID);
  }

  private mapQrUser(user: Awaited<ReturnType<UserStore["findById"]>>): QrLoginSessionStatusResponse["user"] {
    if (!user) return undefined;

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      status: user.status,
      createdAt: user.createTime.toISOString(),
      updatedAt: user.updateTime.toISOString(),
    };
  }

  private async buildQrLoginStatusResponse(
    sessionId: string,
    request?: Request,
  ): Promise<QrLoginSessionStatusResponse> {
    const { payload, expiresIn } = await this.readQrSession(sessionId);

    if (payload.status === "approved" && payload.approvedByUserId) {
      const user = await this.userRepository.findById(payload.approvedByUserId);
      if (!user) throw new NotFoundError("扫码登录用户不存在", CustomCode.NOT_FOUND);

      const authData = await this.authService.completeKnownUserLogin(user, request, {
        source: "qr_login",
        successDescription: "站内扫码登录成功",
      });

      return {
        status: "approved",
        expiresIn,
        auth: authData,
        user: "user" in authData ? authData.user : this.mapQrUser(user),
      };
    }

    if (payload.status === "scanned" && payload.approvedByUserId) {
      const user = await this.userRepository.findById(payload.approvedByUserId);
      return {
        status: payload.status,
        expiresIn,
        user: this.mapQrUser(user),
      };
    }

    return {
      status: payload.status,
      expiresIn,
    };
  }

  private async findExistingIdentity(profile: ExternalIdentityProfile): Promise<UserExternalIdentity | null> {
    const byProviderUserId = await this.externalIdentityRepository.findByProviderIdentity(
      profile.provider,
      profile.providerUserId,
    );
    if (byProviderUserId) return byProviderUserId;

    if (profile.providerUnionId)
      return this.externalIdentityRepository.findByProviderUnionId(profile.provider, profile.providerUnionId);

    return null;
  }

  private normalizeIdentityForBinding(profile: ExternalIdentityProfile): ExternalProviderProfile {
    return {
      ...profile,
      raw: {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        providerUnionId: profile.providerUnionId ?? null,
        providerUsername: profile.providerUsername ?? null,
        providerEmail: profile.providerEmail ?? null,
        avatarUrl: profile.avatarUrl ?? null,
      },
      accessToken: null,
      refreshToken: null,
      scope: null,
    };
  }

  private async saveOrUpdateIdentity(userId: string, profile: ExternalProviderProfile): Promise<UserExternalIdentity> {
    const now = new Date();
    const existing = await this.findExistingIdentity(profile);

    if (existing) {
      if (existing.userId !== userId)
        throw new ConflictError("该外部账号已绑定其他用户", CustomCode.EXTERNAL_IDENTITY_ALREADY_BOUND);

      return this.externalIdentityRepository.updateById(existing.id, {
        providerUnionId: profile.providerUnionId,
        providerUsername: profile.providerUsername,
        providerEmail: profile.providerEmail,
        avatarUrl: profile.avatarUrl,
        profileRaw: profile.raw as any,
        accessToken: profile.accessToken,
        refreshToken: profile.refreshToken,
        scope: profile.scope,
        revokedAt: null,
        lastLoginAt: now,
        lastSyncedAt: now,
        status: 1,
      });
    }

    return this.externalIdentityRepository.create({
      userId,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      providerUnionId: profile.providerUnionId,
      providerUsername: profile.providerUsername,
      providerEmail: profile.providerEmail,
      avatarUrl: profile.avatarUrl,
      profileRaw: profile.raw as any,
      accessToken: profile.accessToken,
      refreshToken: profile.refreshToken,
      scope: profile.scope,
      linkedAt: now,
      lastLoginAt: now,
      lastSyncedAt: now,
      status: 1,
    });
  }

  public async startAuth(
    provider: ExternalAuthProvider,
    action: ExternalAuthAction = "login",
    redirectUri?: string,
    userId?: string,
    request?: Request,
  ): Promise<StartExternalAuthResponse> {
    const socialConfig = await this.configService.getSocialAuthConfig();
    this.assertProviderEnabled(provider, socialConfig);
    const resolvedUserId = userId || (await this.resolveAuthenticatedUserId(request));
    if (action === "bind" && !resolvedUserId) throw new UnauthorizedError("绑定外部账号需要先登录");

    const state = await this.persistExternalState({ provider, action, redirectUri, userId: resolvedUserId });
    const callbackUrl = this.buildCallbackUrl(provider, socialConfig, request, {
      action,
      redirectUri,
    });

    if (provider === "github") {
      const providerConfig = socialConfig.github;
      const authorizeUrl = new URL(providerConfig.authorizeUrl);
      authorizeUrl.searchParams.set("client_id", providerConfig.clientId);
      authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
      authorizeUrl.searchParams.set("scope", providerConfig.scope);
      authorizeUrl.searchParams.set("state", state);

      return {
        provider,
        action,
        authorizeUrl: authorizeUrl.toString(),
        state,
      };
    }

    const providerConfig = provider === "wechat-open" ? socialConfig.wechatOpen : socialConfig.wechatWeb;
    const authorizeUrl = new URL(providerConfig.authorizeUrl);
    authorizeUrl.searchParams.set("appid", providerConfig.appId);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", providerConfig.scope);
    authorizeUrl.searchParams.set("state", state);

    return {
      provider,
      action,
      authorizeUrl: authorizeUrl.toString(),
      state,
    };
  }

  public async handleCallback(
    provider: ExternalAuthProvider,
    code: string,
    state: string,
    request?: Request,
  ): Promise<ExternalAuthCallbackResponse> {
    const statePayload = await this.peekExternalState(state);
    if (statePayload.provider !== provider)
      throw new UnauthorizedError("外部登录状态与提供方不匹配", CustomCode.EXTERNAL_AUTH_STATE_INVALID);

    const socialConfig = await this.configService.getSocialAuthConfig();
    const callbackUrl = this.buildCallbackUrl(provider, socialConfig, request, {
      action: statePayload.action,
      redirectUri: statePayload.redirectUri,
    });
    const profile = await this.fetchProviderProfile(provider, code, request, callbackUrl);
    await this.consumeExternalState(state);

    if (statePayload.action === "bind") {
      const userId = String(statePayload.userId || "").trim();
      if (!userId) throw new UnauthorizedError("绑定态已失效，请重试", CustomCode.EXTERNAL_AUTH_STATE_INVALID);
      await this.saveOrUpdateIdentity(userId, profile);
      const identity = await this.externalIdentityRepository.findByUserIdAndProvider(userId, provider);
      if (!identity) throw new InternalServerError("外部账号绑定失败");
      return this.mapIdentityItem({
        id: identity.id,
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        providerUnionId: identity.providerUnionId,
        providerUsername: identity.providerUsername,
        providerEmail: identity.providerEmail,
        avatarUrl: identity.avatarUrl,
        linkedAt: identity.linkedAt,
        lastLoginAt: identity.lastLoginAt,
        lastSyncedAt: identity.lastSyncedAt,
      });
    }

    const existingIdentity = await this.findExistingIdentity(profile);
    if (!existingIdentity) {
      const binding = await this.createBindingToken({
        provider,
        profile: {
          provider,
          providerUserId: profile.providerUserId,
          providerUnionId: profile.providerUnionId,
          providerUsername: profile.providerUsername,
          providerEmail: profile.providerEmail,
          avatarUrl: profile.avatarUrl,
        },
      });

      return {
        requiresBinding: true,
        provider,
        providerProfile: {
          provider,
          providerUserId: profile.providerUserId,
          providerUnionId: profile.providerUnionId,
          providerUsername: profile.providerUsername,
          providerEmail: profile.providerEmail,
          avatarUrl: profile.avatarUrl,
        },
        bindingToken: binding.token,
        expiresIn: binding.expiresIn,
      } satisfies ExternalAuthBindingRequiredData;
    }

    const user = await this.userRepository.findById(existingIdentity.userId);
    if (!user) throw new NotFoundError("绑定的用户不存在", CustomCode.EXTERNAL_IDENTITY_NOT_BOUND);

    await this.externalIdentityRepository.updateById(existingIdentity.id, {
      providerUnionId: profile.providerUnionId,
      providerUsername: profile.providerUsername,
      providerEmail: profile.providerEmail,
      avatarUrl: profile.avatarUrl,
      profileRaw: profile.raw as any,
      accessToken: profile.accessToken,
      refreshToken: profile.refreshToken,
      scope: profile.scope,
      lastLoginAt: new Date(),
      lastSyncedAt: new Date(),
      status: 1,
      revokedAt: null,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.EXTERNAL_AUTH_LOGIN,
      operationCategory: OperationCategory.AUTH,
      actorUserId: user.id,
      targetUserId: user.id,
      description: `${provider} 外部登录成功`,
      success: true,
      metadata: {
        provider,
        providerUserIdHash: createHash("sha256").update(profile.providerUserId).digest("hex"),
      },
      ipAddress: request?.ip || "unknown",
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    return this.authService.completeKnownUserLogin(user, request, {
      source: "external_login",
      successDescription: `${provider} 外部登录成功`,
    });
  }

  public async listIdentities(userId: string): Promise<ListExternalIdentitiesResponse> {
    const identities = await this.externalIdentityRepository.listByUserId(userId);
    return identities.map((identity) => this.mapIdentityItem(identity));
  }

  public async bindIdentity(
    userId: string,
    provider: ExternalAuthProvider,
    bindingToken: string,
    request?: Request,
  ): Promise<BindExternalIdentityResponse> {
    const payload = await this.consumeBindingToken(bindingToken);
    if (payload.provider !== provider)
      throw new UnauthorizedError("绑定提供方不匹配", CustomCode.EXTERNAL_AUTH_STATE_INVALID);

    const existingSameProvider = await this.externalIdentityRepository.findByUserIdAndProvider(userId, provider);
    if (existingSameProvider && !existingSameProvider.revokedAt)
      throw new ConflictError("当前账号已绑定该提供方", CustomCode.EXTERNAL_IDENTITY_ALREADY_BOUND);

    await this.saveOrUpdateIdentity(userId, this.normalizeIdentityForBinding(payload.profile));

    const identity = await this.externalIdentityRepository.findByUserIdAndProvider(userId, provider);
    if (!identity) throw new InternalServerError("绑定外部账号失败");

    await this.businessLogService.logOperation({
      operationType: OperationType.EXTERNAL_AUTH_BIND,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      description: `绑定 ${provider} 外部账号`,
      success: true,
      metadata: {
        provider,
      },
      ipAddress: request?.ip || "unknown",
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    return this.mapIdentityItem({
      id: identity.id,
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      providerUnionId: identity.providerUnionId,
      providerUsername: identity.providerUsername,
      providerEmail: identity.providerEmail,
      avatarUrl: identity.avatarUrl,
      linkedAt: identity.linkedAt,
      lastLoginAt: identity.lastLoginAt,
      lastSyncedAt: identity.lastSyncedAt,
    });
  }

  public async unbindIdentity(
    userId: string,
    provider: ExternalAuthProvider,
    request?: Request,
  ): Promise<UnbindExternalIdentityResponse> {
    const identity = await this.externalIdentityRepository.findByUserIdAndProvider(userId, provider);
    if (!identity) throw new NotFoundError("当前账号未绑定该外部账号", CustomCode.EXTERNAL_IDENTITY_NOT_BOUND);

    await this.externalIdentityRepository.updateById(identity.id, {
      revokedAt: new Date(),
      status: 0,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.EXTERNAL_AUTH_UNBIND,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      description: `解绑 ${provider} 外部账号`,
      success: true,
      metadata: {
        provider,
      },
      ipAddress: request?.ip || "unknown",
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    return { message: "解绑成功" };
  }

  public async createQrLoginSession(request?: Request): Promise<CreateQrLoginSessionResponse> {
    const socialConfig = await this.configService.getSocialAuthConfig();
    if (!socialConfig.qrLoginEnabled)
      throw new BadRequestError("站内扫码登录未启用", CustomCode.EXTERNAL_AUTH_PROVIDER_DISABLED);

    const sessionId = randomUUID();
    const expiresIn = socialConfig.qrLoginTtlSeconds;
    const requestIp = request ? extractClientIp(request) : "unknown";
    const requestUserAgent = this.getNormalizedUserAgent(request?.headers["user-agent"]);
    const requestLocation = request ? await this.ipGeolocationService.getLocation(requestIp) : undefined;
    const payload: QrLoginSessionPayload = {
      sessionId,
      status: "pending",
      createdAt: new Date().toISOString(),
      requestIp,
      requestLocation,
      requestUserAgent,
      deviceSummary: this.summarizeDevice(requestUserAgent),
    };

    await this.redisService.set(this.qrLoginKey(sessionId), JSON.stringify(payload), expiresIn);

    const scanUrl = `${socialConfig.frontendBaseUrl || this.getBackendOrigin(request)}/auth/qr-approve?sessionId=${encodeURIComponent(sessionId)}`;
    const qrCodeDataUrl = await QRCode.toDataURL(scanUrl);

    await this.businessLogService.logOperation({
      operationType: OperationType.QR_LOGIN_CREATE,
      operationCategory: OperationCategory.AUTH,
      description: "创建站内扫码登录会话",
      success: true,
      metadata: { sessionId },
      ipAddress: request?.ip || "unknown",
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    return {
      sessionId,
      qrCodeDataUrl,
      expiresIn,
      pollIntervalSeconds: socialConfig.qrLoginPollIntervalSeconds,
    };
  }

  private async readQrSession(sessionId: string): Promise<{ payload: QrLoginSessionPayload; expiresIn: number }> {
    const raw = await this.redisService.get(this.qrLoginKey(sessionId));
    if (!raw)
      return {
        payload: {
          sessionId,
          status: "expired",
          createdAt: new Date(0).toISOString(),
        },
        expiresIn: 0,
      };

    const ttl = await this.redisService.ttl(this.qrLoginKey(sessionId));
    const expiresIn = Math.max(0, ttl ?? 0);
    return {
      payload: JSON.parse(raw) as QrLoginSessionPayload,
      expiresIn,
    };
  }

  public async getQrLoginSessionContext(sessionId: string): Promise<QrLoginSessionContextDto> {
    const { payload, expiresIn } = await this.readQrSession(sessionId);
    return this.buildQrLoginSessionContext(sessionId, payload, expiresIn);
  }

  public async markQrSessionScanned(
    sessionId: string,
    userId: string,
    request?: Request,
  ): Promise<QrLoginSessionStatusResponse> {
    const { payload, expiresIn } = await this.readQrSession(sessionId);
    if (payload.status === "expired")
      throw new NotFoundError("扫码登录会话已过期", CustomCode.QR_LOGIN_SESSION_EXPIRED);
    if (payload.status !== "pending" && payload.status !== "scanned")
      throw new ConflictError("扫码登录会话已处理", CustomCode.QR_LOGIN_SESSION_CONSUMED);

    const nextPayload: QrLoginSessionPayload = {
      ...payload,
      status: "scanned",
      approvedByUserId: userId,
    };
    await this.redisService.set(this.qrLoginKey(sessionId), JSON.stringify(nextPayload), Math.max(1, expiresIn));

    await this.businessLogService.logOperation({
      operationType: OperationType.QR_LOGIN_SCAN,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      description: "扫描站内登录二维码",
      success: true,
      metadata: { sessionId },
      ipAddress: request?.ip || "unknown",
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    const user = await this.userRepository.findById(userId);
    return {
      status: nextPayload.status,
      expiresIn,
      user: this.mapQrUser(user),
    };
  }

  public async confirmQrLogin(
    sessionId: string,
    approve: boolean,
    userId: string,
    request?: Request,
  ): Promise<QrLoginSessionStatusResponse> {
    const { payload, expiresIn } = await this.readQrSession(sessionId);
    if (payload.status === "expired")
      throw new NotFoundError("扫码登录会话已过期", CustomCode.QR_LOGIN_SESSION_EXPIRED);
    if (payload.status !== "scanned")
      throw new ConflictError("扫码登录会话尚未进入确认状态", CustomCode.QR_LOGIN_SESSION_PENDING);
    if (payload.approvedByUserId !== userId)
      throw new ForbiddenError("无权确认该扫码登录", CustomCode.PERMISSION_DENIED);

    const nextPayload: QrLoginSessionPayload = {
      ...payload,
      status: approve ? "approved" : "rejected",
      approvedByUserId: userId,
    };
    await this.redisService.set(this.qrLoginKey(sessionId), JSON.stringify(nextPayload), Math.max(1, expiresIn));

    await this.businessLogService.logOperation({
      operationType: OperationType.QR_LOGIN_CONFIRM,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      description: approve ? "确认站内扫码登录" : "拒绝站内扫码登录",
      success: true,
      metadata: { sessionId, approve },
      ipAddress: request?.ip || "unknown",
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    return {
      status: nextPayload.status,
      expiresIn,
    };
  }

  public async getQrLoginStatus(sessionId: string, request?: Request): Promise<QrLoginSessionStatusResponse> {
    return this.buildQrLoginStatusResponse(sessionId, request);
  }

  public async consumeQrLoginSession(sessionId: string, _request?: Request): Promise<QrLoginSessionStatusResponse> {
    const { payload, expiresIn } = await this.readQrSession(sessionId);

    if (payload.status === "expired") {
      return {
        status: "expired",
        expiresIn,
      };
    }

    if (payload.status === "consumed") {
      return {
        status: "consumed",
        expiresIn,
      };
    }

    if (payload.status !== "approved") {
      return this.buildQrLoginStatusResponse(sessionId);
    }

    await this.redisService.set(
      this.qrLoginKey(sessionId),
      JSON.stringify({
        ...payload,
        status: "consumed",
      } satisfies QrLoginSessionPayload),
      Math.max(1, expiresIn),
    );

    return {
      status: "consumed",
      expiresIn,
    };
  }

  public async streamQrLoginStatus(sessionId: string, request: Request, res: Response): Promise<void> {
    this.sseService.initStream(res);

    let closed = false;
    let heartbeatCounter = 0;
    let previousPayload = "";

    const handleClose = () => {
      closed = true;
    };

    request.on("close", handleClose);
    request.on("aborted", handleClose);

    try {
      while (!closed) {
        const status = await this.buildQrLoginStatusResponse(sessionId, request);
        const serializedStatus = JSON.stringify(status);

        if (serializedStatus !== previousPayload || heartbeatCounter >= 10) {
          this.sseService.sendChunk(res, status);
          previousPayload = serializedStatus;
          heartbeatCounter = 0;
        } else {
          heartbeatCounter += 1;
        }

        if (["approved", "rejected", "expired", "consumed"].includes(status.status)) {
          this.sseService.sendDone(res);
          break;
        }

        await this.sleep(1000);
      }
    } catch (error) {
      if (!closed) {
        const message = error instanceof Error ? error.message : "QR stream failed";
        this.sseService.sendError(res, message);
      }
    } finally {
      request.off("close", handleClose);
      request.off("aborted", handleClose);
      if (!res.writableEnded) this.sseService.endStream(res);
    }
  }
}
