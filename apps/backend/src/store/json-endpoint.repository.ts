import { JsonEndpoint } from "@prisma/client";
import { prisma } from "@/config/database";
import { getLogger, LogCategory } from "@/util/logger";
import type {
  CreateJsonEndpointParams,
  JsonEndpointStore,
  UpdateJsonEndpointParams,
} from "./system/json-endpoint.store";
import { MANAGED_STATUS } from "@/constant/status";

export type { CreateJsonEndpointParams, UpdateJsonEndpointParams } from "./system/json-endpoint.store";

const logger = getLogger("JsonEndpointRepository", LogCategory.STORAGE);

/**
 * JsonEndpoint Repository - 单例模式
 * 负责 JSON 端点的数据库操作
 */
export class JsonEndpointRepository implements JsonEndpointStore {
  private static instance: JsonEndpointRepository;

  /**
   * 获取 JsonEndpointRepository 单例实例
   */
  public static getInstance(): JsonEndpointRepository {
    if (!JsonEndpointRepository.instance) JsonEndpointRepository.instance = new JsonEndpointRepository();

    return JsonEndpointRepository.instance;
  }

  /**
   * 创建 JSON 端点
   */
  public async create(params: CreateJsonEndpointParams): Promise<JsonEndpoint> {
    try {
      return await prisma.jsonEndpoint.create({
        data: params,
      });
    } catch (error) {
      logger.error("Failed to create JSON endpoint", error);
      throw error;
    }
  }

  /**
   * 通过 slug 查找端点
   */
  public async findBySlug(slug: string): Promise<JsonEndpoint | null> {
    try {
      return await prisma.jsonEndpoint.findUnique({
        where: { slug, status: MANAGED_STATUS.ENABLED },
      });
    } catch (error) {
      logger.error(`Failed to find JSON endpoint by slug: ${slug}`, error);
      throw error;
    }
  }

  /**
   * 通过 API Key 查找端点
   */
  public async findByApiKey(apiKey: string): Promise<JsonEndpoint | null> {
    try {
      return await prisma.jsonEndpoint.findUnique({
        where: { apiKey, status: MANAGED_STATUS.ENABLED },
      });
    } catch (error) {
      logger.error("Failed to find JSON endpoint by API key", error);
      throw error;
    }
  }

  /**
   * 通过 ID 查找端点
   */
  public async findById(id: string): Promise<JsonEndpoint | null> {
    try {
      return await prisma.jsonEndpoint.findUnique({
        where: { id, status: MANAGED_STATUS.ENABLED },
      });
    } catch (error) {
      logger.error(`Failed to find JSON endpoint by id: ${id}`, error);
      throw error;
    }
  }

  /**
   * 查询用户的所有端点
   */
  public async findByUserId(userId: string): Promise<JsonEndpoint[]> {
    try {
      return await prisma.jsonEndpoint.findMany({
        where: { userId, status: MANAGED_STATUS.ENABLED },
        orderBy: { createTime: "desc" },
      });
    } catch (error) {
      logger.error(`Failed to find JSON endpoints for user: ${userId}`, error);
      throw error;
    }
  }

  /**
   * 更新端点
   */
  public async update(id: string, params: UpdateJsonEndpointParams): Promise<JsonEndpoint> {
    try {
      return await prisma.jsonEndpoint.update({
        where: { id },
        data: params,
      });
    } catch (error) {
      logger.error(`Failed to update JSON endpoint: ${id}`, error);
      throw error;
    }
  }

  /**
   * 增加访问计数 (fire-and-forget)
   */
  public incrementAccessCount(id: string): void {
    prisma.jsonEndpoint
      .update({
        where: { id },
        data: {
          accessCount: { increment: 1 },
          lastAccessAt: new Date(),
        },
      })
      .catch((error) => {
        logger.error(`Failed to increment access count for endpoint: ${id}`, error);
      });
  }

  /**
   * 软删除端点
   */
  public async delete(id: string): Promise<void> {
    try {
      await prisma.jsonEndpoint.update({
        where: { id },
        data: { status: MANAGED_STATUS.DELETED },
      });
    } catch (error) {
      logger.error(`Failed to delete JSON endpoint: ${id}`, error);
      throw error;
    }
  }
}
