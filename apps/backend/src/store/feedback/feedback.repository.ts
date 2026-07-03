import { prisma } from "@/config/database";
import { MANAGED_STATUS } from "@/constant/status";
import { getLogger, LogCategory } from "@/util/logger";
import type {
  FeedbackCommentCreateInput,
  FeedbackCommentWithAuthor,
  FeedbackCreateInput,
  FeedbackListFilters,
  FeedbackStore,
  FeedbackUpdateInput,
  FeedbackWithRelations,
} from "./feedback.store";
import type { Prisma, Feedback, FeedbackComment } from "@prisma/client";

const logger = getLogger("FeedbackRepository", LogCategory.STORAGE);

export class FeedbackRepository implements FeedbackStore {
  private static instance: FeedbackRepository;

  static getInstance(): FeedbackRepository {
    if (!this.instance) this.instance = new FeedbackRepository();
    return this.instance;
  }

  private buildWhere(
    filters: Omit<FeedbackListFilters, "page" | "pageSize"> & { userId?: string },
  ): Prisma.FeedbackWhereInput {
    const keyword = filters.keyword?.trim();
    const orConditions: Prisma.FeedbackWhereInput[] = [];
    if (keyword)
      orConditions.push(
        { id: { contains: keyword } },
        { title: { contains: keyword } },
        { description: { contains: keyword } },
        { user: { username: { contains: keyword } } },
      );

    return {
      status: MANAGED_STATUS.ENABLED,
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.workflowStatus ? { workflowStatus: filters.workflowStatus } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.assigneeUserId ? { assigneeUserId: filters.assigneeUserId } : {}),
      ...(filters.startTime || filters.endTime
        ? {
          createTime: {
            ...(filters.startTime ? { gte: filters.startTime } : {}),
            ...(filters.endTime ? { lte: filters.endTime } : {}),
          },
        }
        : {}),
      ...(orConditions.length > 0 ? { OR: orConditions } : {}),
    };
  }

  private get includeRelations() {
    return {
      user: { select: { id: true, username: true } },
      assignee: { select: { id: true, username: true } },
    } as const;
  }

  async create(data: FeedbackCreateInput): Promise<Feedback> {
    try {
      return await prisma.feedback.create({ data });
    } catch (error) {
      logger.error("Failed to create feedback", error);
      throw error;
    }
  }

  async findById(id: string): Promise<Feedback | null> {
    try {
      return await prisma.feedback.findFirst({
        where: { id, status: MANAGED_STATUS.ENABLED },
      });
    } catch (error) {
      logger.error(`Failed to find feedback by id: ${id}`, error);
      throw error;
    }
  }

  async findByIdWithRelations(id: string): Promise<FeedbackWithRelations | null> {
    try {
      return (await prisma.feedback.findFirst({
        where: { id, status: MANAGED_STATUS.ENABLED },
        include: this.includeRelations,
      })) as FeedbackWithRelations | null;
    } catch (error) {
      logger.error(`Failed to find feedback detail by id: ${id}`, error);
      throw error;
    }
  }

  async findCommentsByFeedbackId(feedbackId: string): Promise<FeedbackCommentWithAuthor[]> {
    try {
      return (await prisma.feedbackComment.findMany({
        where: { feedbackId, status: MANAGED_STATUS.ENABLED },
        include: {
          author: {
            select: { id: true, username: true },
          },
        },
        orderBy: [{ createTime: "asc" }, { id: "asc" }],
      })) as FeedbackCommentWithAuthor[];
    } catch (error) {
      logger.error(`Failed to list feedback comments: ${feedbackId}`, error);
      throw error;
    }
  }

  async createComment(data: FeedbackCommentCreateInput): Promise<FeedbackComment> {
    try {
      return await prisma.feedbackComment.create({ data });
    } catch (error) {
      logger.error("Failed to create feedback comment", error);
      throw error;
    }
  }

  async update(id: string, data: FeedbackUpdateInput): Promise<Feedback> {
    try {
      return await prisma.feedback.update({ where: { id }, data });
    } catch (error) {
      logger.error(`Failed to update feedback: ${id}`, error);
      throw error;
    }
  }

  async delete(id: string): Promise<Feedback> {
    try {
      return await prisma.feedback.update({
        where: { id },
        data: { status: MANAGED_STATUS.DELETED },
      });
    } catch (error) {
      logger.error(`Failed to delete feedback: ${id}`, error);
      throw error;
    }
  }

  async findMyList(
    userId: string,
    filters: FeedbackListFilters,
  ): Promise<{ items: FeedbackWithRelations[]; total: number }> {
    const where = this.buildWhere({ ...filters, userId });
    try {
      const [items, total] = await prisma.$transaction([
        prisma.feedback.findMany({
          where,
          include: this.includeRelations,
          orderBy: [{ lastReplyAt: "desc" }, { createTime: "desc" }],
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
        }),
        prisma.feedback.count({ where }),
      ]);

      return { items: items as FeedbackWithRelations[], total };
    } catch (error) {
      logger.error(`Failed to list feedback for user: ${userId}`, error);
      throw error;
    }
  }

  async findReviewList(filters: FeedbackListFilters): Promise<{ items: FeedbackWithRelations[]; total: number }> {
    const where = this.buildWhere(filters);
    try {
      const [items, total] = await prisma.$transaction([
        prisma.feedback.findMany({
          where,
          include: this.includeRelations,
          orderBy: [{ workflowStatus: "asc" }, { priority: "desc" }, { lastReplyAt: "desc" }, { createTime: "desc" }],
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
        }),
        prisma.feedback.count({ where }),
      ]);

      return { items: items as FeedbackWithRelations[], total };
    } catch (error) {
      logger.error("Failed to list feedback review queue", error);
      throw error;
    }
  }
}
