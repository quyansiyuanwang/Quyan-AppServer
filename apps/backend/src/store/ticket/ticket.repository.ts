import { prisma } from "@/config/database";
import { MANAGED_STATUS } from "@/constant/status";
import { getLogger, LogCategory } from "@/util/logger";
import type {
  OwnTicketTarget,
  OwnTicketDetail,
  TicketCommentCreateInput,
  TicketCommentWithAuthor,
  TicketCreateInput,
  TicketListFilters,
  TicketStore,
  TicketUpdateInput,
  TicketWithRelations,
} from "./ticket.store";
import type { Prisma, Ticket, TicketComment } from "@prisma/client";

import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { ForbiddenError } from "@/util/errors";
import { isTicketTerminalStatus } from "@/constant/ticket";

const ownTicketSelect = {
  id: true,
  userId: true,
  createTime: true,
  updateTime: true,
  lastReplyAt: true,
  workflowStatus: true,
} as const;
const accountUserScope = (accountOwnerId: string): Prisma.UserWhereInput => ({
  status: MANAGED_STATUS.ENABLED,
  OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }],
});
const ownTicketScope = (userId: string, accountOwnerId: string): Prisma.TicketWhereInput => ({
  userId,
  status: MANAGED_STATUS.ENABLED,
  user: accountUserScope(accountOwnerId),
});
const ticketSnapshotScope = (target: OwnTicketTarget, accountOwnerId: string): Prisma.TicketWhereInput => ({
  ...ownTicketScope(target.userId, accountOwnerId),
  id: target.id,
  updateTime: target.updateTime,
  workflowStatus: target.workflowStatus,
});
const ticketSnapshotChanged = () =>
  new ForbiddenError("Ticket authorization snapshot changed", undefined, {
    messageKey: "permission.insufficientPermission",
  });

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

  async findOwnTarget(id: string, userId: string, accountOwnerId: string): Promise<OwnTicketTarget | null> {
    return prisma.ticket.findFirst({
      where: { id, ...ownTicketScope(userId, accountOwnerId) },
      select: ownTicketSelect,
    });
  }

  async scanOwnTargets(
    userId: string,
    accountOwnerId: string,
    filters: TicketListFilters,
    after?: OwnTicketTarget,
  ): Promise<OwnTicketTarget[]> {
    const tieBreak: Prisma.TicketWhereInput = after
      ? { OR: [{ createTime: { lt: after.createTime } }, { createTime: after.createTime, id: { lt: after.id } }] }
      : {};
    const cursor: Prisma.TicketWhereInput = !after
      ? {}
      : after.lastReplyAt
        ? {
            OR: [
              { lastReplyAt: { lt: after.lastReplyAt } },
              { lastReplyAt: null },
              { AND: [{ lastReplyAt: after.lastReplyAt }, tieBreak] },
            ],
          }
        : { AND: [{ lastReplyAt: null }, tieBreak] };
    return prisma.ticket.findMany({
      where: { AND: [this.buildWhere({ ...filters, userId }), ownTicketScope(userId, accountOwnerId), cursor] },
      select: ownTicketSelect,
      orderBy: [{ lastReplyAt: "desc" }, { createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }

  async readOwnTargets(
    userId: string,
    accountOwnerId: string,
    targets: readonly OwnTicketTarget[],
  ): Promise<TicketWithRelations[]> {
    if (!targets.length) return [];
    return prisma.ticket.findMany({
      where: {
        AND: [
          ownTicketScope(userId, accountOwnerId),
          { OR: targets.map((target) => ticketSnapshotScope(target, accountOwnerId)) },
        ],
      },
      include: this.includeRelations,
      orderBy: [{ lastReplyAt: "desc" }, { createTime: "desc" }, { id: "desc" }],
    });
  }

  async readOwnDetail(userId: string, accountOwnerId: string, target: OwnTicketTarget): Promise<OwnTicketDetail> {
    if (target.userId !== userId) throw ticketSnapshotChanged();
    return prisma.$transaction(
      async (tx) => {
        const ticket = await tx.ticket.findFirst({
          where: ticketSnapshotScope(target, accountOwnerId),
          include: this.includeRelations,
        });
        if (!ticket || ticket.id !== target.id || ticket.userId !== userId) throw ticketSnapshotChanged();
        const comments = await tx.ticketComment.findMany({
          where: { ticketId: target.id, status: MANAGED_STATUS.ENABLED, visibility: "public" },
          include: { author: { select: { id: true, username: true } } },
          orderBy: [{ createTime: "asc" }, { id: "asc" }],
        });
        return { ticket, comments };
      },
      { isolationLevel: "Serializable" },
    );
  }

  async createInAccount(data: TicketCreateInput, accountOwnerId: string): Promise<Ticket> {
    return prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findFirst({
          where: { id: data.userId, ...accountUserScope(accountOwnerId) },
          select: { id: true },
        });
        if (user?.id !== data.userId) throw ticketSnapshotChanged();
        return tx.ticket.create({ data });
      },
      { isolationLevel: "Serializable" },
    );
  }

  async updateOwnTarget(target: OwnTicketTarget, accountOwnerId: string, data: TicketUpdateInput): Promise<Ticket> {
    if (isTicketTerminalStatus(target.workflowStatus)) throw ticketSnapshotChanged();
    return prisma.$transaction(
      async (tx) => {
        const changed = await tx.ticket.updateMany({ where: ticketSnapshotScope(target, accountOwnerId), data });
        if (changed.count !== 1) throw ticketSnapshotChanged();
        const ticket = await tx.ticket.findFirst({
          where: { id: target.id, ...ownTicketScope(target.userId, accountOwnerId) },
        });
        if (!ticket || ticket.id !== target.id || ticket.userId !== target.userId) throw ticketSnapshotChanged();
        return ticket;
      },
      { isolationLevel: "Serializable" },
    );
  }

  async commentOwnTarget(
    target: OwnTicketTarget,
    accountOwnerId: string,
    data: TicketCommentCreateInput,
  ): Promise<TicketComment> {
    if (
      data.ticketId !== target.id ||
      data.authorUserId !== target.userId ||
      data.visibility !== "public" ||
      isTicketTerminalStatus(target.workflowStatus)
    )
      throw ticketSnapshotChanged();
    return prisma.$transaction(
      async (tx) => {
        // Atomically touch the checked parent before inserting a comment; closing/reassignment cannot race the snapshot.
        const time = new Date();
        const changed = await tx.ticket.updateMany({
          where: ticketSnapshotScope(target, accountOwnerId),
          data: { lastReplyAt: time },
        });
        if (changed.count !== 1) throw ticketSnapshotChanged();
        return tx.ticketComment.create({ data: { ...data, createTime: time } });
      },
      { isolationLevel: "Serializable" },
    );
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
