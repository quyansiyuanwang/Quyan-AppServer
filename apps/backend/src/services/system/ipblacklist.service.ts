import { IPBlackListRepository, IPBlackList } from "@/store/security/ipblacklist";
import { ConfigService } from "./config.service";
import BusinessLogService from "./businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { getLogger, LogCategory } from "@/util/logger";
import { extractClientIp } from "@/util/ip-extractor";
import type { Request } from "express";
import { BusinessLogRepository } from "@/store/system/businesslog";
import type { IPBlackListStore } from "@/store/security/ipblacklist.store";
import type { BusinessLogStore } from "@/store/system/businesslog.store";
import type {
  MonitoringDashboardResponse,
  IPErrorStatusResponse,
  IPErrorBreakdownItem,
} from "@/api/dto/system/ipblacklist.dto";
import { RedisService } from "@/services/infrastructure/redis.service";
import { RECORD_STATUS } from "@/constant/status";

const logger = getLogger("IPBlackListService", LogCategory.SECURITY);

export interface BanResult {
  banned: boolean;
  level?: number;
  duration?: number;
  expireTime?: Date;
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export class IPBlackListService {
  private static instance: IPBlackListService;
  private constructor(
    private readonly repository: IPBlackListStore = IPBlackListRepository.getInstance(),
    private readonly configService: ConfigService = ConfigService.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly redisService: RedisService = RedisService.getInstance(),
    private readonly businessLogRepository: BusinessLogStore = BusinessLogRepository.getInstance(),
  ) {}

  public static getInstance(): IPBlackListService {
    if (!IPBlackListService.instance) IPBlackListService.instance = new IPBlackListService();

    return IPBlackListService.instance;
  }

  /**
   * 检查错误计数并根据配置的阈值自动封禁 IP
   * @param ip IP 地址
   * @param errorCount 当前小时的错误计数
   * @returns 封禁结果
   */
  public async checkAndBanIfNeeded(ip: string, errorCount: number): Promise<BanResult> {
    try {
      const config = await this.configService.getIpBanConfig();

      // 如果 IP 封禁功能未启用，直接返回
      if (!config.enabled) return { banned: false };

      // 检查是否已经被封禁
      const existingBan = await this.repository.findByIp(ip);
      if (existingBan) {
        // 对已封禁IP检查是否需要升级
        const persistentWeight = await this.applyLazyDecay(ip);
        const effectiveWeight = Math.max(errorCount, persistentWeight);
        const currentLevel = existingBan.banLevel;

        logger.debug(
          `Checking upgrade for banned IP ${ip}: weight=${effectiveWeight.toFixed(2)}, currentLevel=${currentLevel}`,
        );

        // 确定新等级
        let newLevel = currentLevel;
        if (effectiveWeight >= config.level3Threshold) newLevel = 3;
        else if (effectiveWeight >= config.level2Threshold) newLevel = 2;
        else if (effectiveWeight >= config.level1Threshold) newLevel = 1;

        // 如果需要升级
        if (newLevel > currentLevel) {
          const duration =
            newLevel === 3 ? config.level3Duration : newLevel === 2 ? config.level2Duration : config.level1Duration;
          const expireTime = duration === -1 ? new Date("2099-12-31") : new Date(Date.now() + duration * 1000);

          await this.repository.update(existingBan.id, {
            banLevel: newLevel,
            ExpireTime: expireTime,
            reason: `自动升级: 错误权重累计 ${effectiveWeight.toFixed(2)} (Level ${currentLevel} → ${newLevel})`,
          });

          logger.warn(
            `IP ${ip} upgraded from level ${currentLevel} to ${newLevel} (weight: ${effectiveWeight.toFixed(2)})`,
          );

          await this.businessLogService.logOperation({
            operationType: OperationType.IP_BAN,
            operationCategory: OperationCategory.SECURITY,
            targetResourceType: "IP_ADDRESS",
            targetResourceId: ip,
            description: `IP ${ip} 封禁等级自动升级 (Level ${currentLevel} → ${newLevel})`,
            changes: { ip, errorWeight: effectiveWeight, oldLevel: currentLevel, newLevel, duration },
            success: true,
            ipAddress: ip,
          });

          return { banned: true, level: newLevel, duration, expireTime };
        }
        logger.debug(`IP ${ip} no upgrade needed: newLevel=${newLevel}, currentLevel=${currentLevel}`);
        return { banned: true, level: currentLevel };
      }

      // 获取持久化的错误权重（已应用懒衰减）
      const persistentWeight = await this.applyLazyDecay(ip);

      // 使用持久化权重进行判断（如果启用了衰减，这个值会更准确）
      const effectiveWeight = Math.max(errorCount, persistentWeight);

      logger.debug(
        `IP ${ip} ban check: errorCount=${errorCount}, persistentWeight=${persistentWeight.toFixed(2)}, effectiveWeight=${effectiveWeight.toFixed(2)}, thresholds=[L1:${config.level1Threshold}, L2:${config.level2Threshold}, L3:${config.level3Threshold}]`,
      );

      // 根据错误计数确定封禁级别
      let banLevel = 0;
      let duration = 0;

      if (effectiveWeight >= config.level3Threshold) {
        banLevel = 3;
        duration = config.level3Duration;
      } else if (effectiveWeight >= config.level2Threshold) {
        banLevel = 2;
        duration = config.level2Duration;
      } else if (effectiveWeight >= config.level1Threshold) {
        banLevel = 1;
        duration = config.level1Duration;
      }

      // 如果未达到任何阈值，不封禁
      if (banLevel === 0) {
        logger.debug(`IP ${ip} not banned: effectiveWeight ${effectiveWeight.toFixed(2)} below threshold`);
        return { banned: false };
      }

      // 计算过期时间
      const expireTime = duration === -1 ? new Date("2099-12-31") : new Date(Date.now() + duration * 1000);

      // 检查是否存在记录（包括软删除的）
      const anyStatusRecord = await this.repository.findByIpAnyStatus(ip);
      if (anyStatusRecord)
        // 更新现有记录
        await this.repository.update(anyStatusRecord.id, {
          status: RECORD_STATUS.ACTIVE,
          banLevel,
          ExpireTime: expireTime,
          reason: `自动封禁: 错误权重累计 ${effectiveWeight.toFixed(2)} (Level ${banLevel})`,
          banType: "auto",
        });
      else
        try {
          // 创建新封禁记录
          await this.repository.create({
            ipAddress: ip,
            ExpireTime: expireTime,
            banLevel,
            reason: `自动封禁: 错误权重累计 ${effectiveWeight.toFixed(2)} (Level ${banLevel})`,
            banType: "auto",
          });
        } catch (error: any) {
          // 处理并发情况：如果记录已存在（P2002错误），则更新它
          if (error.code === "P2002") {
            const record = await this.repository.findByIpAnyStatus(ip);
            if (record)
              await this.repository.update(record.id, {
                status: RECORD_STATUS.ACTIVE,
                banLevel,
                ExpireTime: expireTime,
                reason: `自动封禁: 错误权重累计 ${effectiveWeight.toFixed(2)} (Level ${banLevel})`,
                banType: "auto",
              });
          } else throw error;
        }

      logger.warn(`IP ${ip} auto-banned at level ${banLevel} for ${effectiveWeight.toFixed(2)} error weight`);

      // 记录业务日志
      await this.businessLogService.logOperation({
        operationType: OperationType.IP_BAN,
        operationCategory: OperationCategory.SECURITY,
        targetResourceType: "IP_ADDRESS",
        targetResourceId: ip,
        description: `IP ${ip} 自动封禁 (Level ${banLevel}, ${effectiveWeight.toFixed(2)} 错误权重)`,
        changes: { ip, errorWeight: effectiveWeight, banLevel, duration },
        success: true,
        ipAddress: ip,
      });

      return {
        banned: true,
        level: banLevel,
        duration,
        expireTime,
      };
    } catch (error) {
      logger.error("Failed to check and ban IP", { error, ip, errorCount });
      throw error;
    }
  }

  /**
   * 手动封禁 IP
   * @param ip IP 地址
   * @param duration 封禁时长（秒），-1 表示永久封禁
   * @param reason 封禁原因
   * @param actorUserId 操作者用户 ID
   * @param request 请求对象（用于记录日志）
   * @returns 创建的黑名单记录
   */
  public async manualBan(
    ip: string,
    duration: number,
    reason: string,
    actorUserId: string,
    request?: Request,
  ): Promise<IPBlackList> {
    try {
      // 检查是否已经被封禁
      const existing = await this.repository.findByIp(ip);
      if (existing) throw new Error(`IP ${ip} 已在黑名单中`);

      const expireTime = duration === -1 ? new Date("2099-12-31") : new Date(Date.now() + duration * 1000);
      const banData = {
        status: RECORD_STATUS.ACTIVE,
        ExpireTime: expireTime,
        banLevel: 0,
        reason: reason || "手动封禁",
        bannedBy: actorUserId,
        banType: "manual",
      };

      // 复用软删除记录，避免 unique 约束冲突
      const anyRecord = await this.repository.findByIpAnyStatus(ip);
      const blacklist = anyRecord
        ? await this.repository.update(anyRecord.id, banData)
        : await this.repository.create({ ipAddress: ip, ...banData });

      logger.info(`IP ${ip} manually banned by user ${actorUserId}`);

      // 记录业务日志
      await this.businessLogService.logOperation({
        operationType: OperationType.IP_BAN,
        operationCategory: OperationCategory.SECURITY,
        actorUserId,
        targetResourceType: "IP_ADDRESS",
        targetResourceId: ip,
        description: `手动封禁 IP ${ip}`,
        changes: { ip, duration, reason },
        success: true,
        ipAddress: extractClientIp(request!),
        userAgent: request?.headers["user-agent"],
        requestId: request?.headers["x-request-id"] as string | undefined,
      });

      return blacklist;
    } catch (error) {
      logger.error("Failed to manually ban IP", { error, ip, actorUserId });
      throw error;
    }
  }

  /**
   * 解除 IP 封禁
   * @param ip IP 地址
   * @param actorUserId 操作者用户 ID
   * @param request 请求对象（用于记录日志）
   * @returns 是否成功解除封禁
   */
  public async unban(ip: string, actorUserId: string, request?: Request): Promise<boolean> {
    try {
      const result = await this.repository.deleteByIp(ip);

      if (result) {
        logger.info(`IP ${ip} unbanned by user ${actorUserId}`);

        // 记录业务日志
        await this.businessLogService.logOperation({
          operationType: OperationType.IP_UNBAN,
          operationCategory: OperationCategory.SECURITY,
          actorUserId,
          targetResourceType: "IP_ADDRESS",
          targetResourceId: ip,
          description: `解除 IP ${ip} 封禁`,
          success: true,
          ipAddress: extractClientIp(request!),
          userAgent: request?.headers["user-agent"],
          requestId: request?.headers["x-request-id"] as string | undefined,
        });
      }

      return result;
    } catch (error) {
      logger.error("Failed to unban IP", { error, ip, actorUserId });
      throw error;
    }
  }

  /**
   * 获取黑名单列表
   * @param pagination 分页参数
   * @returns 黑名单列表和总数
   */
  public async getBlacklist(pagination: PaginationParams = {}): Promise<{ blacklists: IPBlackList[]; total: number }> {
    try {
      return await this.repository.findAll({
        limit: pagination.limit,
        offset: pagination.offset,
        includeExpired: true, // 包括已过期的记录，以便管理员查看历史
      });
    } catch (error) {
      logger.error("Failed to get blacklist", { error, pagination });
      throw error;
    }
  }

  /**
   * 检查 IP 是否被封禁
   * @param ip IP 地址
   * @returns 是否被封禁
   */
  public async isIpBlacklisted(ip: string): Promise<boolean> {
    try {
      return await this.repository.isBlacklisted(ip);
    } catch (error) {
      logger.error("Failed to check if IP is blacklisted", { error, ip });
      throw error;
    }
  }

  /**
   * 获取 IP 的黑名单信息
   * @param ip IP 地址
   * @returns 黑名单记录或 null
   */
  public async getBlacklistInfo(ip: string): Promise<IPBlackList | null> {
    try {
      return await this.repository.findByIp(ip);
    } catch (error) {
      logger.error("Failed to get blacklist info", { error, ip });
      throw error;
    }
  }

  private async applyLazyDecay(ip: string): Promise<number> {
    const weightKey = RedisService.getIpErrorWeightKey(ip);
    const tsKey = RedisService.getIpErrorWeightTsKey(ip);

    const [weightStr, tsStr] = await Promise.all([this.redisService.get(weightKey), this.redisService.get(tsKey)]);

    const weight = parseFloat(weightStr || "0");
    if (weight <= 0 || !tsStr) return weight;

    const config = await this.configService.getErrorDecayConfig();
    if (!config.enabled) return weight;

    const elapsedMinutes = (Date.now() - parseInt(tsStr)) / 60000;
    const intervals = Math.floor(elapsedMinutes / config.interval);
    if (intervals <= 0) return weight;

    const newWeight = weight * Math.pow(1 - config.decayRate / 100, intervals);

    if (newWeight < config.minThreshold) {
      await Promise.all([this.redisService.delete(weightKey), this.redisService.delete(tsKey)]);
      return 0;
    }

    const newTs = parseInt(tsStr) + intervals * config.interval * 60000;
    await Promise.all([
      this.redisService.set(weightKey, newWeight.toFixed(4)),
      this.redisService.set(tsKey, newTs.toString()),
    ]);
    return newWeight;
  }

  public async resetIpErrorWeight(ip: string): Promise<void> {
    const weightKey = RedisService.getIpErrorWeightKey(ip);
    await this.redisService.delete(weightKey);
    // 也删除当前小时的 key（向后兼容）
    const hourKey = RedisService.getIpErrorKey(ip);
    await this.redisService.delete(hourKey);
    await this.redisService.delete(RedisService.getIpErrorWeightTsKey(ip));
    await this.redisService.delete(RedisService.getIpErrorBreakdownKey(ip));
  }

  public async setIpErrorWeight(ip: string, weight: number): Promise<void> {
    const weightKey = RedisService.getIpErrorWeightKey(ip);
    await this.redisService.delete(weightKey);
    await this.redisService.delete(RedisService.getIpErrorWeightTsKey(ip));
    if (weight > 0) {
      await this.redisService.set(weightKey, weight);
      await this.redisService.set(RedisService.getIpErrorWeightTsKey(ip), Date.now().toString());
    }
  }

  public async getIpErrorStatus(ip: string): Promise<IPErrorStatusResponse> {
    const [config, decayConfig, errorWeight, isBanned, rawBreakdown] = await Promise.all([
      this.configService.getIpBanConfig(),
      this.configService.getErrorDecayConfig(),
      this.applyLazyDecay(ip),
      this.repository.isBlacklisted(ip),
      this.redisService.hGetAll(RedisService.getIpErrorBreakdownKey(ip)),
    ]);
    const thresholds = {
      level1: config.level1Threshold,
      level2: config.level2Threshold,
      level3: config.level3Threshold,
    };

    let currentLevel = 0;
    if (errorWeight >= config.level3Threshold) currentLevel = 3;
    else if (errorWeight >= config.level2Threshold) currentLevel = 2;
    else if (errorWeight >= config.level1Threshold) currentLevel = 1;

    const HTTP_STATUS_DESCRIPTIONS: Record<string, string> = {
      "400": "Bad Request",
      "401": "Unauthorized",
      "403": "Forbidden",
      "404": "Not Found",
      "422": "Unprocessable Entity",
      "429": "Too Many Requests",
      "500": "Internal Server Error",
      "502": "Bad Gateway",
      "503": "Service Unavailable",
    };

    const items: IPErrorBreakdownItem[] = [];
    if (rawBreakdown) {
      for (const [key, val] of Object.entries(rawBreakdown)) {
        const w = parseFloat(val);
        if (!isFinite(w) || w <= 0) continue;
        if (key.startsWith("c:")) items.push({ key, type: "custom", code: key.slice(2), weight: w, percentage: 0 });
        else if (key.startsWith("s:")) {
          const code = key.slice(2);
          items.push({
            key,
            type: "status",
            code,
            weight: w,
            percentage: 0,
            description: HTTP_STATUS_DESCRIPTIONS[code],
          });
        }
      }
      items.sort((a, b) => b.weight - a.weight);
    }

    const breakdownTotal = items.reduce((sum, x) => sum + x.weight, 0);
    if (breakdownTotal > 0)
      for (const item of items) item.percentage = Math.round((item.weight / breakdownTotal) * 1000) / 10;

    return { ipAddress: ip, errorWeight, currentLevel, thresholds, isBanned, decayConfig, errorBreakdown: items };
  }

  /**
   * 获取监控面板数据
   * @returns 监控面板数据
   */
  public async getMonitoringDashboard(): Promise<MonitoringDashboardResponse> {
    try {
      const now = new Date();
      const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // 获取活跃封禁
      const { blacklists: allBans } = await this.repository.findAll({ includeExpired: false });
      const activeBans = allBans.filter((b) => b.ExpireTime && b.ExpireTime > now);

      // 统计封禁级别
      const byLevel = { level1: 0, level2: 0, level3: 0 };
      activeBans.forEach((b) => {
        if (b.banLevel === 1) byLevel.level1++;
        else if (b.banLevel === 2) byLevel.level2++;
        else if (b.banLevel === 3) byLevel.level3++;
      });

      // 统计封禁类型
      const byType = { auto: 0, manual: 0 };
      activeBans.forEach((b) => {
        if (b.banType === "auto") byType.auto++;
        else byType.manual++;
      });

      // 获取最近封禁记录（最多20条）
      const recentBans = activeBans.slice(0, 20);

      // 查询最近24小时和7天的封禁活动
      const [bans24h, bans7d] = await Promise.all([
        this.businessLogRepository.query({
          page: 1,
          pageSize: 1000,
          operationType: OperationType.IP_BAN,
          startDate: last24Hours,
        }),
        this.businessLogRepository.query({
          page: 1,
          pageSize: 1000,
          operationType: OperationType.IP_BAN,
          startDate: last7Days,
        }),
      ]);

      // 生成7天时间线
      const timeline: Array<{ date: string; count: number }> = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split("T")[0];
        const count = bans7d.logs.filter((log) => {
          const logDate = log.createTime.toISOString().split("T")[0];
          return logDate === dateStr;
        }).length;
        timeline.push({ date: dateStr, count });
      }

      // 统计被封禁次数最多的IP
      const ipBanCounts = new Map<string, { count: number; lastBanTime: Date }>();
      bans7d.logs.forEach((log) => {
        const ip = log.targetResourceId;
        if (ip) {
          const existing = ipBanCounts.get(ip);
          if (existing) {
            existing.count++;
            if (log.createTime > existing.lastBanTime) existing.lastBanTime = log.createTime;
          } else ipBanCounts.set(ip, { count: 1, lastBanTime: log.createTime });
        }
      });

      const topBannedIPs = Array.from(ipBanCounts.entries())
        .map(([ip, data]) => ({
          ipAddress: ip,
          banCount: data.count,
          lastBanTime: data.lastBanTime.toISOString(),
          currentStatus: activeBans.some((b) => b.ipAddress === ip) ? ("banned" as const) : ("unbanned" as const),
        }))
        .sort((a, b) => b.banCount - a.banCount)
        .slice(0, 10);

      return {
        activeBans: {
          total: activeBans.length,
          byLevel,
          byType,
          recentBans: recentBans.map((b) => ({
            id: b.id,
            ipAddress: b.ipAddress,
            expireTime: b.ExpireTime?.toISOString() || "",
            banLevel: b.banLevel,
            banReason: b.reason || "",
            bannedBy: b.bannedBy,
            errorCount: 0,
            metadata: {},
            status: b.status,
            createTime: b.createTime.toISOString(),
            updateTime: b.updateTime.toISOString(),
          })),
        },
        recentActivity: {
          last24Hours: bans24h.total,
          last7Days: bans7d.total,
          timeline,
        },
        topBannedIPs,
      };
    } catch (error) {
      logger.error("Failed to get monitoring dashboard", { error });
      throw error;
    }
  }
}
