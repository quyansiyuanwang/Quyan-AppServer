import { v4 as uuidv4 } from "uuid";
import { getLogger, LogCategory } from "@/util/logger";
import { RedisService } from "@/services/infrastructure/redis.service";

const logger = getLogger("ReURLService", LogCategory.SECURITY);
const REURL_KEY_PREFIX = "reurl:token:";

/**
 * ReURL 服务
 *
 * 功能：
 * - 生成临时的短链接（reurl），用于代替 JWT token
 * - 使用 Redis 存储 reurl -> JWT token 映射，保证多实例一致性
 * - 支持自定义过期时间（TTL）
 *
 * 使用单例模式，确保全局只有一个 Redis 访问实例
 */
export class ReURLService {
  private static instance: ReURLService;
  private readonly redisService: RedisService;

  private constructor() {
    this.redisService = RedisService.getInstance();

    logger.info("ReURL Service 已初始化，存储后端: Redis");
  }

  private buildRedisKey(reurlId: string): string {
    return `${REURL_KEY_PREFIX}${reurlId}`;
  }

  /**
   * 获取 ReURLService 单例实例
   */
  public static getInstance(): ReURLService {
    if (!ReURLService.instance) ReURLService.instance = new ReURLService();

    return ReURLService.instance;
  }

  /**
   * 生成 reurl
   *
   * @param token JWT token
   * @param ttl 过期时间（秒）
   * @returns reurl ID
   */
  public generateReURL(token: string, ttl: number): string {
    const reurlId = uuidv4();
    const ttlSeconds = Math.max(1, Math.floor(ttl));

    // 存储到 Redis 中，设置 TTL
    void this.redisService.set(this.buildRedisKey(reurlId), token, ttlSeconds);

    logger.info(`生成 ReURL: ${reurlId}, TTL: ${ttl}秒`);

    return reurlId;
  }

  /**
   * 根据 reurl ID 获取 JWT token
   *
   * @param reurlId ReURL ID
   * @returns JWT token，如果不存在或已过期则返回 undefined
   */
  public async getToken(reurlId: string): Promise<string | undefined> {
    const token = await this.redisService.get(this.buildRedisKey(reurlId));

    if (token) logger.debug(`ReURL ${reurlId} 验证成功`);
    else logger.warn(`ReURL ${reurlId} 不存在或已过期`);

    return token || undefined;
  }

  /**
   * 撤销 reurl（主动删除）
   *
   * @param reurlId ReURL ID
   */
  public async revokeReURL(reurlId: string): Promise<void> {
    await this.redisService.delete(this.buildRedisKey(reurlId));
    logger.info(`ReURL ${reurlId} 已被撤销`);
  }

  /**
   * 获取缓存统计信息
   */
  public getStats() {
    return {
      size: -1,
      max: -1,
    };
  }
}
