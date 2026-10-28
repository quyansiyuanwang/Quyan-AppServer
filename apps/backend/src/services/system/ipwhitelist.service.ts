import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PermissionService } from "@/services/users/permission.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformIpWhitelistWriteIamService } from "./platform-ip-whitelist-write-iam.service";
import { createIPWhitelistBodySchema, ipWhitelistIpParamsSchema } from "@/api/schema/system/ipwhitelist.schema";
import { BadRequestError, ConflictError } from "@/util/errors";
import { PlatformIpWhitelistReadIamService } from "./platform-ip-whitelist-read-iam.service";
import type { TypedRequest } from "@/types/express";
import { IPWhiteListRepository, IPWhiteList } from "@/store/security/ipwhitelist";
import type { IPWhiteListStore } from "@/store/security/ipwhitelist.store";
import { RedisService } from "@/services/infrastructure/redis.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { Request } from "express";
import { extractClientIp } from "@/util/ip-extractor";
import BusinessLogService from "./businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";

const logger = getLogger("IPWhiteListService", LogCategory.SECURITY);
const CACHE_TTL = 60;
const cacheKey = (ip: string) => `ip:whitelist:${ip}`;

export class IPWhiteListService {
  private static instance: IPWhiteListService;

  private constructor(
    private readonly repository: IPWhiteListStore = IPWhiteListRepository.getInstance(),
    private readonly redis: RedisService = RedisService.getInstance(),
    private readonly businessLog: BusinessLogService = BusinessLogService.getInstance(),
    private readonly iamReads = PlatformIpWhitelistReadIamService.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
    private readonly iamWrites = PlatformIpWhitelistWriteIamService.getInstance(),
  ) {}

  static getInstance(): IPWhiteListService {
    if (!IPWhiteListService.instance) IPWhiteListService.instance = new IPWhiteListService();
    return IPWhiteListService.instance;
  }

  private async assertReadPermission(request: TypedRequest, permission = Permission.IP_WHITELIST_READ) {
    const principal = request && getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [permission], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
  }
  async listManaged(limit: number | undefined, offset: number | undefined, request: TypedRequest) {
    if (env.security.iamAuthorizationMode === "enforce") return this.iamReads.list(limit, offset, request);
    await this.assertReadPermission(request);
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        await this.iamReads.list(limit, offset, request, false);
      } catch {
        logger.warn("IP whitelist list shadow evaluation failed", { reason: "iam-evaluation-denied-or-unavailable" });
      }
    }
    return this.list(limit, offset);
  }
  async isManagedWhitelisted(ip: string, request: TypedRequest) {
    if (env.security.iamAuthorizationMode === "enforce") return this.iamReads.status(ip, request);
    await this.assertReadPermission(request);
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        await this.iamReads.status(ip, request);
      } catch {
        logger.warn("IP whitelist status shadow evaluation failed", { reason: "iam-evaluation-denied-or-unavailable" });
      }
    }
    return this.isWhitelisted(ip);
  }
  async addManaged(
    ip: string,
    reason: string,
    actorUserId: string,
    expiresAt: Date | undefined,
    request: TypedRequest,
  ): Promise<IPWhiteList> {
    const parsed = createIPWhitelistBodySchema.safeParse({
      ipAddress: ip,
      reason,
      expiresAt:
        expiresAt instanceof Date && Number.isFinite(expiresAt.getTime()) ? expiresAt.toISOString() : expiresAt,
    });
    if (!parsed.success)
      throw new BadRequestError("Invalid IP whitelist entry", undefined, { messageKey: "errors.badRequest" });
    const principal = request && getIamPrincipal(request);
    if (
      !principal ||
      principal.subjectUserId !== actorUserId ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    const address = parsed.data.ipAddress;
    if (env.security.iamAuthorizationMode === "enforce") {
      const row = await this.iamWrites.create(address, reason, actorUserId, expiresAt, request);
      if (!row) throw iamAccountDenied();
      return this.completeAdd(row, actorUserId, request);
    }
    await this.assertReadPermission(request, Permission.IP_WHITELIST_CREATE);
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        await this.iamWrites.create(address, reason, actorUserId, expiresAt, request, false);
      } catch {
        logger.warn("IP whitelist creation shadow evaluation failed", {
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    }
    return this.add(address, reason, actorUserId, expiresAt, request);
  }
  async removeManaged(ip: string, actorUserId: string, request: TypedRequest): Promise<boolean> {
    const parsed = ipWhitelistIpParamsSchema.safeParse({ ip });
    if (!parsed.success)
      throw new BadRequestError("Invalid IP whitelist address", undefined, { messageKey: "errors.badRequest" });
    const principal = request && getIamPrincipal(request);
    if (
      !principal ||
      principal.subjectUserId !== actorUserId ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    if (env.security.iamAuthorizationMode === "enforce") {
      const removed = await this.iamWrites.remove(parsed.data.ip, actorUserId, request);
      if (removed) await this.completeRemove(parsed.data.ip, actorUserId, request);
      return removed;
    }
    await this.assertReadPermission(request, Permission.IP_WHITELIST_DELETE);
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        await this.iamWrites.remove(parsed.data.ip, actorUserId, request, false);
      } catch {
        logger.warn("IP whitelist removal shadow evaluation failed", {
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    }
    return this.remove(parsed.data.ip, actorUserId, request);
  }
  private async refreshCache(ip: string) {
    try {
      if (this.redis.isRedisAvailable())
        await this.redis.set(cacheKey(ip), (await this.repository.isWhitelisted(ip)) ? "1" : "0", CACHE_TTL);
    } catch {
      logger.warn("IP whitelist cache refresh failed", { reason: "cache-unavailable" });
    }
  }
  async isWhitelisted(ip: string): Promise<boolean> {
    try {
      if (!this.redis.isRedisAvailable()) return await this.repository.isWhitelisted(ip);

      const cached = await this.redis.get(cacheKey(ip));
      // A cached positive is only a hint: expiry and revocation always require a current database check.
      if (cached === "0") return false;

      const result = await this.repository.isWhitelisted(ip);

      if (this.redis.isRedisAvailable()) await this.redis.set(cacheKey(ip), result ? "1" : "0", CACHE_TTL);

      return result;
    } catch {
      return await this.repository.isWhitelisted(ip);
    }
  }

  async add(
    ip: string,
    reason: string,
    actorUserId: string,
    expiresAt?: Date,
    request?: Request,
  ): Promise<IPWhiteList> {
    const existing = await this.repository.findByIp(ip);
    if (existing)
      throw new ConflictError("IP whitelist entry already exists", undefined, { messageKey: "errors.conflict" });
    const record = await this.repository.create({ ipAddress: ip, reason, addedBy: actorUserId, expiresAt });
    return this.completeAdd(record, actorUserId, request);
  }
  private async completeAdd(record: IPWhiteList, actorUserId: string, request?: Request): Promise<IPWhiteList> {
    const { ipAddress: ip, reason, expiresAt } = record;
    await this.refreshCache(ip);
    logger.info(`IP ${ip} added to whitelist by ${actorUserId}`);
    await this.businessLog.logOperation({
      operationType: OperationType.IP_WHITELIST_ADD,
      operationCategory: OperationCategory.SECURITY,
      actorUserId,
      targetResourceType: "IP_ADDRESS",
      targetResourceId: ip,
      description: `添加 IP ${ip} 到白名单`,
      changes: { ip, reason, expiresAt },
      success: true,
      ipAddress: extractClientIp(request!),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });
    return record;
  }

  async remove(ip: string, actorUserId: string, request?: Request): Promise<boolean> {
    const result = await this.repository.deleteByIp(ip);
    if (result) {
      await this.completeRemove(ip, actorUserId, request);
    }
    return result;
  }
  private async completeRemove(ip: string, actorUserId: string, request?: Request) {
    await this.refreshCache(ip);
    logger.info(`IP ${ip} removed from whitelist by ${actorUserId}`);
    await this.businessLog.logOperation({
      operationType: OperationType.IP_WHITELIST_REMOVE,
      operationCategory: OperationCategory.SECURITY,
      actorUserId,
      targetResourceType: "IP_ADDRESS",
      targetResourceId: ip,
      description: `从白名单移除 IP ${ip}`,
      success: true,
      ipAddress: extractClientIp(request!),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });
  }

  async list(limit?: number, offset?: number) {
    return this.repository.findAll({ limit, offset });
  }
}
