import type { AuthCenterClient } from "@prisma/client";
import { prisma } from "@/config/database";
import { MANAGED_STATUS } from "@/constant/status";
import { getLogger, LogCategory } from "@/util/logger";
import type {
  AuthCenterClientCreateInput,
  AuthCenterClientReviewListFilters,
  AuthCenterClientReviewListItem,
  AuthCenterClientStore,
  AuthCenterClientUpdateInput,
} from "./auth-center-client.store";

const logger = getLogger("AuthCenterClientRepository", LogCategory.STORAGE);

export class AuthCenterClientRepository implements AuthCenterClientStore {
  private static instance: AuthCenterClientRepository;

  static getInstance(): AuthCenterClientRepository {
    if (!this.instance) this.instance = new AuthCenterClientRepository();
    return this.instance;
  }

  async create(data: AuthCenterClientCreateInput): Promise<AuthCenterClient> {
    try {
      return await prisma.authCenterClient.create({ data });
    } catch (error) {
      logger.error("Failed to create Auth Center client", error);
      throw error;
    }
  }

  async findById(id: string): Promise<AuthCenterClient | null> {
    try {
      return await prisma.authCenterClient.findFirst({
        where: { id, status: MANAGED_STATUS.ENABLED },
      });
    } catch (error) {
      logger.error(`Failed to find Auth Center client by id: ${id}`, error);
      throw error;
    }
  }

  async findByClientId(clientId: string): Promise<AuthCenterClient | null> {
    try {
      return await prisma.authCenterClient.findFirst({
        where: { clientId, status: MANAGED_STATUS.ENABLED },
      });
    } catch (error) {
      logger.error(`Failed to find Auth Center client by clientId: ${clientId}`, error);
      throw error;
    }
  }

  async findByUserId(userId: string): Promise<AuthCenterClient[]> {
    try {
      return await prisma.authCenterClient.findMany({
        where: { userId, status: MANAGED_STATUS.ENABLED },
        orderBy: { createTime: "desc" },
      });
    } catch (error) {
      logger.error(`Failed to list Auth Center clients for user: ${userId}`, error);
      throw error;
    }
  }

  async findReviewList(
    filters: AuthCenterClientReviewListFilters,
  ): Promise<{ items: AuthCenterClientReviewListItem[]; total: number }> {
    const where = {
      status: MANAGED_STATUS.ENABLED,
      ...(filters.reviewStatus ? { reviewStatus: filters.reviewStatus } : {}),
      ...(filters.keyword
        ? {
          OR: [
            { name: { contains: filters.keyword } },
            { clientId: { contains: filters.keyword } },
            { user: { username: { contains: filters.keyword } } },
          ],
        }
        : {}),
    };

    try {
      const [items, total] = await prisma.$transaction([
        prisma.authCenterClient.findMany({
          where,
          include: {
            user: {
              select: { id: true, username: true },
            },
            reviewedBy: {
              select: { id: true, username: true },
            },
          },
          orderBy: [{ submittedAt: "asc" }, { createTime: "desc" }],
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
        }),
        prisma.authCenterClient.count({ where }),
      ]);

      return { items: items as AuthCenterClientReviewListItem[], total };
    } catch (error) {
      logger.error("Failed to list Auth Center clients for review", error);
      throw error;
    }
  }

  async update(id: string, data: AuthCenterClientUpdateInput): Promise<AuthCenterClient> {
    try {
      return await prisma.authCenterClient.update({
        where: { id },
        data,
      });
    } catch (error) {
      logger.error(`Failed to update Auth Center client: ${id}`, error);
      throw error;
    }
  }

  async delete(id: string): Promise<AuthCenterClient> {
    try {
      return await prisma.authCenterClient.update({
        where: { id },
        data: { status: MANAGED_STATUS.DELETED },
      });
    } catch (error) {
      logger.error(`Failed to delete Auth Center client: ${id}`, error);
      throw error;
    }
  }
}
