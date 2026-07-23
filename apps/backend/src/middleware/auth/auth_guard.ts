import { HttpStatusCode } from "axios";
import { JWTAccessIns, JWTPayload } from "../../util/auth";
import { createHash } from "crypto";
import { Response, NextFunction } from "express";
import { CustomCode } from "@/constant/custom-code";
import { UnauthorizedError, ForbiddenError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
import { isLocalRequest } from "./local_auth";
import { ReURLService } from "@/services/system/reurl.service";
import { getLogger, LogCategory } from "@/util/logger";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { setRequestContext } from "@/util/request-context";
import { EnvSpace } from "@/config/env";
import { validateAccountStatus } from "@/util/auth/account-status";
import { UserRepository } from "@/store/users/user.repository";
import { RamRoleRepository } from "@/store/users/ram-role.repository";
import { extractRelayToken } from "@/util/relay-auth";
import { RedisService } from "@/services/infrastructure/redis.service";
import { buildForceOfflineAuthSessionKey, extractAuthSessionId } from "@/util/auth-session";
import { DEFAULT_BACKEND_LOCALE, translateKnownMessage } from "@/locales";
import { OAuthAuthorizationRepository } from "@/store/oauth/oauth-authorization.repository";

const logger = getLogger("AuthGuard", LogCategory.SYSTEM);
const userRepository = UserRepository.getInstance();
const ramRoleRepository = RamRoleRepository.getInstance();
const redisService = RedisService.getInstance();
const oauthAuthorizationRepository = OAuthAuthorizationRepository.getInstance();

const getForceOfflineUserKey = (userId: string) => `user:force_offline:${userId}`;

const localize = (req: TypedRequest, message: string) =>
  translateKnownMessage(message, req.locale ?? DEFAULT_BACKEND_LOCALE);

const hashOpaqueToken = (token: string) => createHash("sha256").update(token).digest("hex");

const readJsonStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
};

type AuthContextSubject = NonNullable<TypedRequest["authContext"]>["subjectType"];

async function attachAuthContext(
  request: TypedRequest,
  payload: JWTPayload,
  user: { id: string; accountOwnerId?: string | null },
  subjectType?: AuthContextSubject,
): Promise<JWTPayload> {
  const accountOwnerId = payload.accountOwnerId || user.accountOwnerId || user.id;
  const principalUserId = payload.principalUserId || user.id;
  const resolvedSubjectType: AuthContextSubject =
    subjectType ||
    payload.subjectType ||
    (payload.impersonatorId ? "impersonation" : user.accountOwnerId ? "sub_user" : "root");

  if (payload.roleSessionId) {
    const session = await ramRoleRepository.findActiveRoleSession(payload.roleSessionId);
    if (!session) throw new UnauthorizedError("角色会话不存在或已过期", CustomCode.AUTH_FAILED);
    if (session.subjectUserId !== principalUserId || session.roleId !== payload.assumedRoleId)
      throw new UnauthorizedError("角色会话与令牌不匹配", CustomCode.AUTH_FAILED);
  }

  const enrichedPayload: JWTPayload = {
    ...payload,
    principalUserId,
    accountOwnerId,
    subjectType: resolvedSubjectType,
  };

  request.user = enrichedPayload;
  request.authContext = {
    principalUserId,
    accountOwnerId,
    subjectType: resolvedSubjectType,
    assumedRoleId: enrichedPayload.assumedRoleId,
    roleSessionId: enrichedPayload.roleSessionId,
  };

  return enrichedPayload;
}

async function authenticateOAuthAccessToken(
  request: TypedRequest,
  token: string,
  scopes?: string[],
): Promise<JWTPayload> {
  const requiredScopes = (scopes ?? []).map((scope) => scope.trim()).filter(Boolean);

  if (requiredScopes.length === 0) {
    logger.warn(
      `OAuth access token is not allowed on unscoped endpoint: ${request.method} ${request.path} from ${request.ip}`,
    );
    throw new UnauthorizedError("OAuth access token is not allowed for this endpoint");
  }

  const accessToken = await oauthAuthorizationRepository.findAccessTokenByHash(hashOpaqueToken(token));
  if (!accessToken) {
    logger.warn(`OAuth access token not found: ${request.method} ${request.path} from ${request.ip}`);
    throw new UnauthorizedError("Unauthorized: Invalid OAuth access token");
  }

  if (accessToken.revokedAt) throw new UnauthorizedError("OAuth access token has been revoked");
  if (accessToken.expiresAt.getTime() <= Date.now()) throw new UnauthorizedError("OAuth access token has expired");

  const tokenScopes = readJsonStringArray(accessToken.scopes);
  const missingScopes = requiredScopes.filter((scope) => !tokenScopes.includes(scope));
  if (missingScopes.length > 0) throw new ForbiddenError(`Insufficient OAuth scope: ${missingScopes.join(", ")}`);

  const user = await userRepository.findById(accessToken.userId);
  if (!user) {
    logger.warn(
      `User not found for OAuth access token: userId=${accessToken.userId}, ${request.method} ${request.path} from ${request.ip}`,
    );
    throw new UnauthorizedError("用户不存在");
  }

  validateAccountStatus(user.status, accessToken.userId, `OAuth ${request.method} ${request.path}`);

  const payload: JWTPayload = {
    userId: user.id,
    updatedAt: user.updateTime.toISOString(),
    status: user.status,
    authType: "oauth",
    oauthClientId: accessToken.oauthClientId,
    oauthScopes: tokenScopes,
  };

  request.user = payload;
  await attachAuthContext(request, payload, user, "oauth");
  request.oauthAccessToken = {
    id: accessToken.id,
    oauthClientId: accessToken.oauthClientId,
    clientId: accessToken.oauthClient.clientId,
    clientName: accessToken.oauthClient.name,
    userId: accessToken.userId,
    scopes: tokenScopes,
    expiresAt: accessToken.expiresAt.toISOString(),
  };

  await oauthAuthorizationRepository.touchAccessTokenLastUsed(accessToken.id, new Date());
  return payload;
}

/**
 * Express 中间件：用于路由级别的认证
 * 支持两种token传递方式：
 * 1. Authorization header: Bearer <token>
 * 2. URL 参数: ?token=<token>
 */
export async function authMiddleware(req: TypedRequest, res: Response, next: NextFunction) {
  // 优先从 Authorization header 获取 token
  let token: string | undefined;
  const authHeader = req.headers["authorization"];

  if (authHeader && authHeader.startsWith("Bearer ")) token = authHeader.replace("Bearer ", "").trim();
  else if (req.query.token && typeof req.query.token === "string")
    // 如果 header 中没有，则从 URL 参数获取
    token = req.query.token.trim();

  // 检查是否为 reurl 格式
  if (token && token.startsWith("reurl:")) {
    const reurlId = token.substring(6); // 去掉 "reurl:" 前缀
    const realToken = await ReURLService.getInstance().getToken(reurlId);
    if (!realToken) {
      logger.warn(`ReURL expired or invalid: ${req.method} ${req.path} from ${req.ip}`);
      return res
        .status(HttpStatusCode.Unauthorized)
        .json({ code: CustomCode.AUTH_FAILED, message: localize(req, "ReURL 已过期或无效") });
    }

    token = realToken;
  }

  if (!token) {
    logger.warn(`No token provided: ${req.method} ${req.path} from ${req.ip}`);
    return res
      .status(HttpStatusCode.Unauthorized)
      .json({ code: CustomCode.AUTH_FAILED, message: localize(req, "Unauthorized: No token provided") });
  }

  try {
    const payload = await JWTAccessIns.verifyToken(token);
    if (!payload) {
      logger.warn(`Invalid token: ${req.method} ${req.path} from ${req.ip}`);
      return res
        .status(HttpStatusCode.Unauthorized)
        .json({ code: CustomCode.AUTH_FAILED, message: localize(req, "Unauthorized: Invalid token") });
    }

    // 验证用户的updatedAt是否与token中的一致
    const user = await userRepository.findById(payload.userId);
    if (!user) {
      logger.warn(`User not found: userId=${payload.userId}, ${req.method} ${req.path} from ${req.ip}`);
      return res
        .status(HttpStatusCode.Unauthorized)
        .json({ code: CustomCode.AUTH_FAILED, message: localize(req, "用户不存在") });
    }

    // 检查账号状态（从 token 中的 status 字段，如果没有则从数据库查询）
    const userStatus = payload.status ?? user.status;
    try {
      validateAccountStatus(userStatus, payload.userId, `${req.method} ${req.path}`);
    } catch (error) {
      if (error instanceof ForbiddenError)
        return res
          .status(HttpStatusCode.Forbidden)
          .json({ code: error.code || CustomCode.ACCOUNT_DISABLED, message: localize(req, error.message) });

      return res
        .status(HttpStatusCode.Unauthorized)
        .json({ code: CustomCode.AUTH_FAILED, message: localize(req, error.message) });
    }

    // 检查token中是否包含updatedAt字段（兼容旧token）
    if (!payload.updatedAt) {
      logger.warn(`Old token version: userId=${payload.userId}, ${req.method} ${req.path} from ${req.ip}`);
      return res
        .status(HttpStatusCode.Unauthorized)
        .json({ code: CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE, message: localize(req, "Token版本过旧，请重新登录") });
    }

    const currentUpdatedAt = user.updateTime.toISOString();
    const forcedOffline = await redisService.get(getForceOfflineUserKey(payload.userId));
    if (forcedOffline) {
      logger.warn(`User force-offlined: userId=${payload.userId}, ${req.method} ${req.path} from ${req.ip}`);
      return res
        .status(HttpStatusCode.Unauthorized)
        .json({ code: CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE, message: localize(req, "用户已被强制下线，请重新登录") });
    }

    const authSessionId = extractAuthSessionId(req);
    if (authSessionId) {
      const forcedSession = await redisService.get(buildForceOfflineAuthSessionKey(authSessionId));
      if (forcedSession) {
        logger.warn(
          `Session force-offlined: userId=${payload.userId}, session=${authSessionId}, ${req.method} ${req.path} from ${req.ip}`,
        );
        return res.status(HttpStatusCode.Unauthorized).json({
          code: CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE,
          message: localize(req, "当前会话已被强制结束，请重新登录"),
        });
      }
    }

    if (payload.updatedAt !== currentUpdatedAt) {
      logger.warn(`User info updated: userId=${payload.userId}, ${req.method} ${req.path} from ${req.ip}`);
      return res
        .status(HttpStatusCode.Unauthorized)
        .json({ code: CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE, message: localize(req, "用户信息已更新，请重新登录") });
    }

    await attachAuthContext(req, payload, user);
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid token";
    logger.warn(`Token verification failed: ${message}, ${req.method} ${req.path} from ${req.ip}`);
    return res
      .status(HttpStatusCode.Unauthorized)
      .json({ code: CustomCode.AUTH_FAILED, message: localize(req, `Unauthorized: ${message}`) });
  }
}

export type SecurityScheme = "jwt" | "local-or-jwt" | "relay-token" | "project-key";

/**
 * tsoa 认证函数：用于 @Security 装饰器
 * @param request Express Request 对象
 * @param securityName 安全方案名称（如 "jwt", "local-or-jwt"）
 * @param scopes 权限范围（可选）
 */
export async function expressAuthentication(
  request: TypedRequest,
  securityName: SecurityScheme,
  scopes?: string[],
): Promise<any> {
  // 设置请求上下文，使装饰器可以访问request
  setRequestContext(request);

  // 本地访问或 JWT 认证方案
  if (securityName === "local-or-jwt") {
    // 如果是本地请求且不在测试环境，直接放行
    // 在测试环境中，即使是本地请求也需要验证 JWT
    if (isLocalRequest(request) && !EnvSpace.isTest) return { local: true };

    // 否则进行 JWT 认证（继续执行下面的 jwt 逻辑）
    securityName = "jwt";
  }

  if (securityName === "relay-token") {
    const token = extractRelayToken(request);

    if (!token) {
      logger.warn(`No relay token provided: ${request.method} ${request.path} from ${request.ip}`);
      throw new UnauthorizedError("Unauthorized: No relay token provided");
    }

    const relayTokenService = new RelayTokenService();
    const relayToken = await relayTokenService.validateToken(token, request);

    const user = await userRepository.findById(relayToken.userId);
    if (!user) {
      logger.warn(
        `User not found for RelayToken: userId=${relayToken.userId}, ${request.method} ${request.path} from ${request.ip}`,
      );
      throw new UnauthorizedError("用户不存在");
    }

    validateAccountStatus(user.status, relayToken.userId, `RelayToken ${request.method} ${request.path}`);

    request.relayToken = relayToken;
    return { relayToken: true };
  }

  if (securityName === "project-key") {
    const authHeader = request.headers["authorization"];
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token.startsWith("dk_")) throw new UnauthorizedError("Unauthorized: No project API key provided");

    const { DeveloperProjectService } = await import("@/services/developer/developer-project.service");
    const projectKey = await DeveloperProjectService.getInstance().authenticateProjectKey(token, scopes ?? []);
    request.projectApiKey = projectKey;
    const user = await userRepository.findById(projectKey.project.userId);
    if (!user) throw new UnauthorizedError("用户不存在");
    validateAccountStatus(user.status, user.id, `ProjectKey ${request.method} ${request.path}`);

    const payload: JWTPayload = {
      userId: user.id,
      updatedAt: user.updateTime.toISOString(),
      status: user.status,
    };
    await attachAuthContext(request, payload, user, "project_key");
    return { projectKey: true };
  }

  if (securityName === "jwt") {
    const authHeader = request.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn(`No token provided: ${request.method} ${request.path} from ${request.ip}`);
      throw new UnauthorizedError("Unauthorized: No token provided");
    }

    let token = authHeader.replace("Bearer ", "").trim();

    // 检查是否为中转令牌
    if (token.startsWith("rlt_")) {
      const relayTokenService = new RelayTokenService();
      const relayToken = await relayTokenService.validateToken(token, request);

      // 获取用户信息并验证状态
      const user = await userRepository.findById(relayToken.userId);
      if (!user) {
        logger.warn(
          `User not found for RelayToken: userId=${relayToken.userId}, ${request.method} ${request.path} from ${request.ip}`,
        );
        throw new UnauthorizedError("用户不存在");
      }

      // 检查账号状态
      validateAccountStatus(user.status, relayToken.userId, `RelayToken ${request.method} ${request.path}`);

      request.relayToken = relayToken;
      request.authContext = {
        principalUserId: user.id,
        accountOwnerId: user.accountOwnerId || user.id,
        subjectType: "relay",
      };
      request.authContext = {
        principalUserId: user.id,
        accountOwnerId: user.accountOwnerId || user.id,
        subjectType: "relay",
      };
      return { relayToken: true };
    }

    // 检查是否为 AccessKey
    if (token.startsWith("ak_")) {
      const { AccessKeyService } = await import("@/services/users/accesskey.service");
      const accessKeyService = new AccessKeyService();
      const accessKey = await accessKeyService.validateKey(token);
      await accessKeyService.updateUsage(accessKey.id);

      // 获取用户信息以构建完整的 JWTPayload
      const user = await userRepository.findById(accessKey.userId);
      if (!user) {
        logger.warn(
          `User not found for AccessKey: userId=${accessKey.userId}, ${request.method} ${request.path} from ${request.ip}`,
        );
        throw new UnauthorizedError("用户不存在");
      }

      // 检查账号状态
      validateAccountStatus(user.status, accessKey.userId, `AccessKey ${request.method} ${request.path}`);

      const payload: JWTPayload = {
        userId: user.id,
        updatedAt: user.updateTime.toISOString(),
        status: user.status,
      };

      request.accessKey = accessKey;
      return attachAuthContext(request, payload, user, "access_key");
    }

    // 检查是否为 reurl 格式
    if (token.startsWith("reurl:")) {
      const reurlId = token.substring(6); // 去掉 "reurl:" 前缀
      const realToken = await ReURLService.getInstance().getToken(reurlId);
      if (!realToken) {
        logger.warn(`ReURL expired or invalid: ${request.method} ${request.path} from ${request.ip}`);
        throw new UnauthorizedError("ReURL 已过期或无效");
      }

      token = realToken;
    }

    if (token.startsWith("oat_")) return authenticateOAuthAccessToken(request, token, scopes);

    const payload = await JWTAccessIns.verifyToken(token);

    if (!payload) {
      logger.warn(`Invalid token: ${request.method} ${request.path} from ${request.ip}`);
      throw new UnauthorizedError("Unauthorized: Invalid token");
    }

    // 验证用户的updatedAt是否与token中的一致
    const user = await userRepository.findById(payload.userId);
    if (!user) {
      logger.warn(`User not found: userId=${payload.userId}, ${request.method} ${request.path} from ${request.ip}`);
      throw new UnauthorizedError("用户不存在");
    }

    // 检查账号状态（从 token 中的 status 字段，如果没有则从数据库查询）
    const userStatus = payload.status ?? user.status;
    validateAccountStatus(userStatus, payload.userId, `${request.method} ${request.path}`);

    // 检查token中是否包含updatedAt字段（兼容旧token）
    if (!payload.updatedAt) {
      logger.warn(`Old token version: userId=${payload.userId}, ${request.method} ${request.path} from ${request.ip}`);
      throw new UnauthorizedError("Token版本过旧，请重新登录", CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE);
    }

    const currentUpdatedAt = user.updateTime.toISOString();
    const forcedOffline = await redisService.get(getForceOfflineUserKey(payload.userId));
    if (forcedOffline) {
      logger.warn(
        `User force-offlined: userId=${payload.userId}, ${request.method} ${request.path} from ${request.ip}`,
      );
      throw new UnauthorizedError("用户已被强制下线，请重新登录", CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE);
    }

    const authSessionId = extractAuthSessionId(request);
    if (authSessionId) {
      const forcedSession = await redisService.get(buildForceOfflineAuthSessionKey(authSessionId));
      if (forcedSession) {
        logger.warn(
          `Session force-offlined: userId=${payload.userId}, session=${authSessionId}, ${request.method} ${request.path} from ${request.ip}`,
        );
        throw new UnauthorizedError("当前会话已被强制结束，请重新登录", CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE);
      }
    }

    if (payload.updatedAt !== currentUpdatedAt) {
      logger.warn(`User info updated: userId=${payload.userId}, ${request.method} ${request.path} from ${request.ip}`);
      throw new UnauthorizedError("用户信息已更新，请重新登录", CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE);
    }

    // 将 payload 附加到 request 对象，使 controller 可以访问
    const enrichedPayload = await attachAuthContext(request, payload, user);

    // 只读模拟模式：拦截所有变更请求
    if (enrichedPayload.impersonatorId && enrichedPayload.impersonationMode === "view") {
      const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
      if (mutationMethods.has(request.method))
        throw new ForbiddenError("只读模拟模式下不允许执行写操作", CustomCode.IMPERSONATION_READONLY_VIOLATION);
    }

    return enrichedPayload;
  }

  throw new Error(`Unknown security name: ${securityName}`);
}
