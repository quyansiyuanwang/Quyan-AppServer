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
  ) {}

  static getInstance(): IPWhiteListService {
    if (!IPWhiteListService.instance) IPWhiteListService.instance = new IPWhiteListService();
    return IPWhiteListService.instance;
  }

  async isWhitelisted(ip: string): Promise<boolean> {
    try {
      if (!this.redis.isRedisAvailable()) return await this.repository.isWhitelisted(ip);

      const cached = await this.redis.get(cacheKey(ip));
      if (cached !== null) return cached === "1";

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
    if (existing) throw new Error(`IP ${ip} 已在白名单中`);
    const record = await this.repository.create({ ipAddress: ip, reason, addedBy: actorUserId, expiresAt });
    await this.redis.set(cacheKey(ip), "1", CACHE_TTL);
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
      await this.redis.set(cacheKey(ip), "0", CACHE_TTL);
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
    return result;
  }

  async list(limit?: number, offset?: number) {
    return this.repository.findAll({ limit, offset });
  }
}
