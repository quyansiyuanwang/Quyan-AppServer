import type { OAuthClient } from "@prisma/client";
import { prisma } from "@/config/database";
import { MANAGED_STATUS } from "@/constant/status";
import { getLogger, LogCategory } from "@/util/logger";
import type {
  OAuthClientCreateInput,
  OAuthClientReviewListFilters,
  OAuthClientReviewListItem,
  OAuthClientStore,
  OAuthClientUpdateInput,
} from "./oauth-client.store";

const logger = getLogger("OAuthClientRepository", LogCategory.STORAGE);

export class OAuthClientRepository implements OAuthClientStore {
  private static instance: OAuthClientRepository;

  static getInstance(): OAuthClientRepository {
    if (!this.instance) this.instance = new OAuthClientRepository();
    return this.instance;
  }

  async create(data: OAuthClientCreateInput): Promise<OAuthClient> {
    try {
      return await prisma.oAuthClient.create({
        data,
      });
    } catch (error) {
      logger.error("Failed to create OAuth client", error);
      throw error;
    }
  }

  async findById(id: string): Promise<OAuthClient | null> {
    try {
      return await prisma.oAuthClient.findFirst({
        where: { id, status: MANAGED_STATUS.ENABLED },
      });
    } catch (error) {
      logger.error(`Failed to find OAuth client by id: ${id}`, error);
      throw error;
    }
  }

  async findByClientId(clientId: string): Promise<OAuthClient | null> {
    try {
      return await prisma.oAuthClient.findFirst({
        where: { clientId, status: MANAGED_STATUS.ENABLED },
      });
    } catch (error) {
      logger.error(`Failed to find OAuth client by clientId: ${clientId}`, error);
      throw error;
    }
  }

  async findByUserId(userId: string): Promise<OAuthClient[]> {
    try {
      return await prisma.oAuthClient.findMany({
        where: { userId, status: MANAGED_STATUS.ENABLED },
        orderBy: { createTime: "desc" },
      });
    } catch (error) {
      logger.error(`Failed to list OAuth clients for user: ${userId}`, error);
      throw error;
    }
  }

  async findReviewList(
    filters: OAuthClientReviewListFilters,
  ): Promise<{ items: OAuthClientReviewListItem[]; total: number }> {
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
        prisma.oAuthClient.findMany({
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
        prisma.oAuthClient.count({ where }),
      ]);

      return { items: items as OAuthClientReviewListItem[], total };
    } catch (error) {
      logger.error("Failed to list OAuth clients for review", error);
      throw error;
    }
  }

  async update(id: string, data: OAuthClientUpdateInput): Promise<OAuthClient> {
    try {
      return await prisma.oAuthClient.update({
        where: { id },
        data,
      });
    } catch (error) {
      logger.error(`Failed to update OAuth client: ${id}`, error);
      throw error;
    }
  }

  async delete(id: string): Promise<OAuthClient> {
    try {
      return await prisma.oAuthClient.update({
        where: { id },
        data: { status: MANAGED_STATUS.DELETED },
      });
    } catch (error) {
      logger.error(`Failed to delete OAuth client: ${id}`, error);
      throw error;
    }
  }
}
