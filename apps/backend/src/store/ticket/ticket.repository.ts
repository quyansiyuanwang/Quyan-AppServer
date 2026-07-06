import { prisma } from "@/config/database";
import { MANAGED_STATUS } from "@/constant/status";
import { getLogger, LogCategory } from "@/util/logger";
import type {
  TicketCommentCreateInput,
  TicketCommentWithAuthor,
  TicketCreateInput,
  TicketListFilters,
  TicketStore,
  TicketUpdateInput,
  TicketWithRelations,
} from "./ticket.store";
import type { Prisma, Ticket, TicketComment } from "@prisma/client";

const logger = getLogger("TicketRepository", LogCategory.STORAGE);

export class TicketRepository implements TicketStore {
  private static instance: TicketRepository;

  static getInstance(): TicketRepository {
    if (!this.instance) this.instance = new TicketRepository();
    return this.instance;
  }

  private buildWhere(
    filters: Omit<TicketListFilters, "page" | "pageSize"> & { userId?: string },
  ): Prisma.TicketWhereInput {
    const keyword = filters.keyword?.trim();
    const orConditions: Prisma.TicketWhereInput[] = [];
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

  async create(data: TicketCreateInput): Promise<Ticket> {
    try {
      return await prisma.ticket.create({ data });
    } catch (error) {
      logger.error("Failed to create ticket", error);
      throw error;
    }
  }

  async findById(id: string): Promise<Ticket | null> {
    try {
      return await prisma.ticket.findFirst({
        where: { id, status: MANAGED_STATUS.ENABLED },
      });
    } catch (error) {
      logger.error(`Failed to find ticket by id: ${id}`, error);
      throw error;
    }
  }

  async findByIdWithRelations(id: string): Promise<TicketWithRelations | null> {
    try {
      return (await prisma.ticket.findFirst({
        where: { id, status: MANAGED_STATUS.ENABLED },
        include: this.includeRelations,
      })) as TicketWithRelations | null;
    } catch (error) {
      logger.error(`Failed to find ticket detail by id: ${id}`, error);
      throw error;
    }
  }

  async findCommentsByTicketId(ticketId: string): Promise<TicketCommentWithAuthor[]> {
    try {
      return (await prisma.ticketComment.findMany({
        where: { ticketId, status: MANAGED_STATUS.ENABLED },
        include: {
          author: {
            select: { id: true, username: true },
          },
        },
        orderBy: [{ createTime: "asc" }, { id: "asc" }],
      })) as TicketCommentWithAuthor[];
    } catch (error) {
      logger.error(`Failed to list ticket comments: ${ticketId}`, error);
      throw error;
    }
  }

  async createComment(data: TicketCommentCreateInput): Promise<TicketComment> {
    try {
      return await prisma.ticketComment.create({ data });
    } catch (error) {
      logger.error("Failed to create ticket comment", error);
      throw error;
    }
  }

  async update(id: string, data: TicketUpdateInput): Promise<Ticket> {
    try {
      return await prisma.ticket.update({ where: { id }, data });
    } catch (error) {
      logger.error(`Failed to update ticket: ${id}`, error);
      throw error;
    }
  }

  async delete(id: string): Promise<Ticket> {
    try {
      return await prisma.ticket.update({
        where: { id },
        data: { status: MANAGED_STATUS.DELETED },
      });
    } catch (error) {
      logger.error(`Failed to delete ticket: ${id}`, error);
      throw error;
    }
  }

  async findMyList(
    userId: string,
    filters: TicketListFilters,
  ): Promise<{ items: TicketWithRelations[]; total: number }> {
    const where = this.buildWhere({ ...filters, userId });
    try {
      const [items, total] = await prisma.$transaction([
        prisma.ticket.findMany({
          where,
          include: this.includeRelations,
          orderBy: [{ lastReplyAt: "desc" }, { createTime: "desc" }],
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
        }),
        prisma.ticket.count({ where }),
      ]);

      return { items: items as TicketWithRelations[], total };
    } catch (error) {
      logger.error(`Failed to list tickets for user: ${userId}`, error);
      throw error;
    }
  }

  async findReviewList(filters: TicketListFilters): Promise<{ items: TicketWithRelations[]; total: number }> {
    const where = this.buildWhere(filters);
    try {
      const [items, total] = await prisma.$transaction([
        prisma.ticket.findMany({
          where,
          include: this.includeRelations,
          orderBy: [{ workflowStatus: "asc" }, { priority: "desc" }, { lastReplyAt: "desc" }, { createTime: "desc" }],
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
        }),
        prisma.ticket.count({ where }),
      ]);

      return { items: items as TicketWithRelations[], total };
    } catch (error) {
      logger.error("Failed to list ticket review queue", error);
      throw error;
    }
  }
}
