import type { PrismaClient } from "@prisma/client";
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("OAuthClientBootstrap", LogCategory.APPLICATION);

/**
 * 系统 OAuth 客户端启动验证服务
 * 用于在应用启动时验证系统客户端的存在性和完整性
 */
export class OAuthClientBootstrapService {
  private static instance: OAuthClientBootstrapService | null = null;

  private constructor(private readonly prisma: PrismaClient) {}

  static getInstance(prisma: PrismaClient): OAuthClientBootstrapService {
    if (!this.instance) {
      this.instance = new OAuthClientBootstrapService(prisma);
    }
    return this.instance;
  }

  /**
   * 验证系统级 OAuth 客户端
   * 不创建，仅验证和记录警告
   */
  async verifySystemClients(): Promise<void> {
    const systemClientIds = ["quyan-cli"];

    for (const clientId of systemClientIds) {
      const client = await this.prisma.oAuthClient.findUnique({
        where: { clientId },
      });

      if (!client) {
        logger.error(`系统 OAuth 客户端缺失: ${clientId}. 请运行 'pnpm run db:seed:prod' 修复。`);
      } else if (!client.isSystemClient) {
        logger.warn(`OAuth 客户端 ${clientId} 未标记为系统客户端`);
      } else if (client.reviewStatus !== "approved") {
        logger.warn(`系统客户端 ${clientId} 状态为 ${client.reviewStatus}，应为 'approved'`);
      } else {
        logger.info(`系统 OAuth 客户端 ${clientId} 验证通过`);
      }
    }
  }
}
