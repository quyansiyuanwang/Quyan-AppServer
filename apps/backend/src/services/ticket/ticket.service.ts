import type { Ticket, TicketComment } from "@prisma/client";
import type { Request } from "express";
import type {
  CreateTicketCommentDto,
  CreateTicketDto,
  CreateTicketReviewCommentDto,
  TicketCommentDto,
  TicketDetailDto,
  TicketListItemDto,
  TicketListQueryDto,
  TicketListResponseDto,
  TicketReviewAssignmentConfigDto,
  TicketReviewListQueryDto,
  ReviewTicketDto,
  SetTicketReviewAssignmentConfigDto,
  UpdateMyTicketDto,
} from "@/api/dto/ticket/ticket.dto";
import {
  DEFAULT_TICKET_PRIORITY,
  TICKET_PRIORITIES,
  TICKET_TYPES,
  DEFAULT_TICKET_WORKFLOW_STATUS,
  isTicketTerminalStatus,
} from "@/constant/ticket";
import { NotificationEvent } from "@/constant/notification-event";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { Permission } from "@/constant/permission";
import BusinessLogService from "@/services/system/businesslog.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import { NotificationService } from "@/services/notification/notification.service";
import { ConfigService, type TicketAssignmentRule } from "@/services/system/config.service";
import { PermissionService } from "@/services/users/permission.service";
import { TicketRepository } from "@/store/ticket/ticket.repository";
import type { TicketCommentWithAuthor, TicketStore, TicketWithRelations } from "@/store/ticket/ticket.store";
import { UserRepository } from "@/store/users/user.repository";
import { AccountStatus } from "@/util/auth/account-status";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";

const INTERNAL_VISIBILITY = "internal";
const PUBLIC_VISIBILITY = "public";
const TICKET_ASSIGNMENT_CURSOR_TTL_SECONDS = 60 * 60 * 24 * 30;

export class TicketService {
  private static instance: TicketService | null = null;

  private constructor(
    private readonly repository: TicketStore = TicketRepository.getInstance(),
    private readonly userRepository: UserRepository = UserRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly notificationService: NotificationService = NotificationService.getInstance(),
    private readonly configService: ConfigService = ConfigService.getInstance(),
    private readonly permissionService: PermissionService = PermissionService.getInstance(),
    private readonly redisService: RedisService = RedisService.getInstance(),
  ) {}

  static getInstance(): TicketService {
    if (!this.instance) this.instance = new TicketService();
    return this.instance;
  }

  async createTicket(userId: string, body: CreateTicketDto, request?: Request): Promise<TicketDetailDto> {
    const autoAssigneeUserId = await this.resolveAutoAssigneeUserId(body.type, DEFAULT_TICKET_PRIORITY);

    const created = await this.repository.create({
      userId,
      type: body.type,
      title: body.title.trim(),
      description: body.description.trim(),
      sourcePage: this.normalizeNullableText(body.sourcePage),
      reproduceSteps: this.normalizeNullableText(body.reproduceSteps),
      contactInfo: this.normalizeNullableText(body.contactInfo),
      workflowStatus: DEFAULT_TICKET_WORKFLOW_STATUS,
      priority: DEFAULT_TICKET_PRIORITY,
      assigneeUserId: autoAssigneeUserId ?? undefined,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.TICKET_CREATE,
      operationCategory: OperationCategory.SYSTEM,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: created.id,
      targetResourceType: "TICKET",
      description: `提交工单 '${created.title}'`,
      changes: { type: created.type, priority: created.priority },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    if (autoAssigneeUserId)
      await this.notificationService.dispatch(autoAssigneeUserId, NotificationEvent.TICKET_ASSIGNED, {
        subject: "你有新的工单待处理",
        summary:
          autoAssigneeUserId === userId
            ? `你创建的工单《${created.title}》已自动分配给你`
            : `工单《${created.title}》已自动分配给你`,
        ticketId: created.id,
        priority: created.priority,
        autoAssigned: true,
      });
    else await this.notifyPendingReviewUsers(created.id, created.title, created.priority, userId);

    return this.getMyTicketDetail(created.id, userId);
  }

  async listMyTickets(userId: string, query: TicketListQueryDto): Promise<TicketListResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const { items, total } = await this.repository.findMyList(userId, {
      page,
      pageSize,
      keyword: query.keyword,
      workflowStatus: query.workflowStatus,
      type: query.type,
    });

    return {
      items: items.map((item) => this.toListItemDto(item)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  async getMyTicketDetail(id: string, userId: string): Promise<TicketDetailDto> {
    const ticket = await this.requireOwnedTicket(id, userId);
    const comments = await this.repository.findCommentsByTicketId(id);
    return this.toDetailDto(
      ticket,
      comments.filter((item) => item.visibility !== INTERNAL_VISIBILITY),
    );
  }

  async updateMyTicket(
    id: string,
    userId: string,
    body: UpdateMyTicketDto,
    request?: Request,
  ): Promise<TicketDetailDto> {
    const existing = await this.requireOwnedTicket(id, userId);
    if (isTicketTerminalStatus(existing.workflowStatus)) throw new BadRequestError("当前工单已结束，不能再修改");

    const updateData = this.buildSelfUpdateInput(body);
    if (Object.keys(updateData).length === 0) return this.getMyTicketDetail(id, userId);

    const updated = await this.repository.update(id, updateData);

    await this.businessLogService.logOperation({
      operationType: OperationType.TICKET_UPDATE,
      operationCategory: OperationCategory.SYSTEM,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: updated.id,
      targetResourceType: "TICKET",
      description: `更新工单 '${updated.title}'`,
      changes: { before: this.pickMutableFields(existing), after: this.pickMutableFields(updated) },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.getMyTicketDetail(id, userId);
  }

  async addMyComment(
    id: string,
    userId: string,
    body: CreateTicketCommentDto,
    request?: Request,
  ): Promise<TicketCommentDto> {
    const ticket = await this.requireOwnedTicket(id, userId);
    if (isTicketTerminalStatus(ticket.workflowStatus)) throw new BadRequestError("当前工单已结束，不能再追加评论");

    const created = await this.repository.createComment({
      ticketId: id,
      authorUserId: userId,
      visibility: PUBLIC_VISIBILITY,
      content: body.content.trim(),
    });

    await this.repository.update(id, { lastReplyAt: created.createTime });

    await this.businessLogService.logOperation({
      operationType: OperationType.TICKET_COMMENT_CREATE,
      operationCategory: OperationCategory.SYSTEM,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: ticket.id,
      targetResourceType: "TICKET",
      description: `为工单 '${ticket.title}' 添加评论`,
      changes: { visibility: PUBLIC_VISIBILITY },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toCommentDto({
      ...created,
      author: {
        id: userId,
        username: (await this.userRepository.findActiveUsernameById(userId)) ?? userId,
      },
    });
  }

  async listReviewTickets(query: TicketReviewListQueryDto): Promise<TicketListResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { items, total } = await this.repository.findReviewList({
      page,
      pageSize,
      keyword: query.keyword,
      workflowStatus: query.workflowStatus,
      type: query.type,
      priority: query.priority,
      assigneeUserId: query.assigneeUserId,
      userId: query.userId,
      startTime: this.parseDate(query.startTime),
      endTime: this.parseDate(query.endTime),
    });

    return {
      items: items.map((item) => this.toListItemDto(item)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  async getReviewTicketDetail(id: string): Promise<TicketDetailDto> {
    const ticket = await this.repository.findByIdWithRelations(id);
    if (!ticket) throw new NotFoundError("工单不存在");
    const comments = await this.repository.findCommentsByTicketId(id);
    return this.toDetailDto(ticket, comments);
  }

  async reviewTicket(
    id: string,
    reviewerUserId: string,
    body: ReviewTicketDto,
    request?: Request,
  ): Promise<TicketDetailDto> {
    const existing = await this.repository.findByIdWithRelations(id);
    if (!existing) throw new NotFoundError("工单不存在");

    const updateData: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(body, "type") && body.type !== undefined) updateData.type = body.type;

    if (Object.prototype.hasOwnProperty.call(body, "workflowStatus") && body.workflowStatus !== undefined)
      updateData.workflowStatus = body.workflowStatus;

    if (Object.prototype.hasOwnProperty.call(body, "priority") && body.priority !== undefined)
      updateData.priority = body.priority;

    if (Object.prototype.hasOwnProperty.call(body, "assigneeUserId")) {
      const normalizedAssignee = this.normalizeNullableId(body.assigneeUserId);
      if (normalizedAssignee) {
        const assignee = await this.userRepository.findActiveById(normalizedAssignee);
        if (!assignee) throw new BadRequestError("分配的处理人不存在或不可用");
      }
      updateData.assigneeUserId = normalizedAssignee;
    }

    if (Object.keys(updateData).length === 0) return this.getReviewTicketDetail(id);

    const updated = await this.repository.update(id, updateData);

    if (existing.type !== updated.type)
      await this.businessLogService.logOperation({
        operationType: OperationType.TICKET_TYPE_CHANGE,
        operationCategory: OperationCategory.SYSTEM,
        actorUserId: reviewerUserId,
        targetUserId: existing.userId,
        targetResourceId: updated.id,
        targetResourceType: "TICKET",
        description: `更正工单 '${updated.title}' 类型`,
        changes: { beforeType: existing.type, afterType: updated.type },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });

    if (existing.workflowStatus !== updated.workflowStatus) {
      await this.businessLogService.logOperation({
        operationType: OperationType.TICKET_STATUS_CHANGE,
        operationCategory: OperationCategory.SYSTEM,
        actorUserId: reviewerUserId,
        targetUserId: existing.userId,
        targetResourceId: updated.id,
        targetResourceType: "TICKET",
        description: `更新工单 '${updated.title}' 状态`,
        changes: { beforeStatus: existing.workflowStatus, afterStatus: updated.workflowStatus },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });

      if (existing.userId !== reviewerUserId)
        await this.notificationService.dispatch(existing.userId, NotificationEvent.TICKET_STATUS_UPDATED, {
          subject: "工单状态已更新",
          summary: `你的工单《${updated.title}》状态已变更为 ${updated.workflowStatus}`,
          ticketId: updated.id,
          workflowStatus: updated.workflowStatus,
        });
    }

    if (existing.priority !== updated.priority)
      await this.businessLogService.logOperation({
        operationType: OperationType.TICKET_PRIORITY_CHANGE,
        operationCategory: OperationCategory.SYSTEM,
        actorUserId: reviewerUserId,
        targetUserId: existing.userId,
        targetResourceId: updated.id,
        targetResourceType: "TICKET",
        description: `更新工单 '${updated.title}' 优先级`,
        changes: { beforePriority: existing.priority, afterPriority: updated.priority },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });

    if (existing.assigneeUserId !== updated.assigneeUserId) {
      await this.businessLogService.logOperation({
        operationType: OperationType.TICKET_ASSIGN,
        operationCategory: OperationCategory.SYSTEM,
        actorUserId: reviewerUserId,
        targetUserId: existing.userId,
        targetResourceId: updated.id,
        targetResourceType: "TICKET",
        description: `调整工单 '${updated.title}' 处理人`,
        changes: { beforeAssigneeUserId: existing.assigneeUserId, afterAssigneeUserId: updated.assigneeUserId },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });

      if (updated.assigneeUserId)
        await this.notificationService.dispatch(updated.assigneeUserId, NotificationEvent.TICKET_ASSIGNED, {
          subject: "你有新的工单待处理",
          summary:
            updated.assigneeUserId === reviewerUserId
              ? `你已将工单《${updated.title}》分配给自己`
              : `工单《${updated.title}》已分配给你`,
          ticketId: updated.id,
          priority: updated.priority,
        });
    }

    return this.getReviewTicketDetail(id);
  }

  async addReviewComment(
    id: string,
    reviewerUserId: string,
    body: CreateTicketReviewCommentDto,
    request?: Request,
  ): Promise<TicketCommentDto> {
    const ticket = await this.repository.findByIdWithRelations(id);
    if (!ticket) throw new NotFoundError("工单不存在");

    const created = await this.repository.createComment({
      ticketId: id,
      authorUserId: reviewerUserId,
      visibility: body.visibility,
      content: body.content.trim(),
    });

    await this.repository.update(id, { lastReplyAt: created.createTime });

    await this.businessLogService.logOperation({
      operationType: OperationType.TICKET_COMMENT_CREATE,
      operationCategory: OperationCategory.SYSTEM,
      actorUserId: reviewerUserId,
      targetUserId: ticket.userId,
      targetResourceId: ticket.id,
      targetResourceType: "TICKET",
      description: `为工单 '${ticket.title}' 添加${body.visibility === INTERNAL_VISIBILITY ? "内部" : "公开"}评论`,
      changes: { visibility: body.visibility },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    if (body.visibility === PUBLIC_VISIBILITY && ticket.userId !== reviewerUserId)
      await this.notificationService.dispatch(ticket.userId, NotificationEvent.TICKET_PUBLIC_REPLY, {
        subject: "你的工单收到了新回复",
        summary: `工单《${ticket.title}》有新的处理回复`,
        ticketId: ticket.id,
      });

    return this.toCommentDto({
      ...created,
      author: {
        id: reviewerUserId,
        username: (await this.userRepository.findActiveUsernameById(reviewerUserId)) ?? reviewerUserId,
      },
    });
  }

  async deleteTicket(id: string, reviewerUserId: string, request?: Request): Promise<void> {
    const ticket = await this.repository.findById(id);
    if (!ticket) throw new NotFoundError("工单不存在");
    await this.repository.delete(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.TICKET_DELETE,
      operationCategory: OperationCategory.SYSTEM,
      actorUserId: reviewerUserId,
      targetUserId: ticket.userId,
      targetResourceId: ticket.id,
      targetResourceType: "TICKET",
      description: `删除工单 '${ticket.title}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  async getAssignmentConfig(): Promise<TicketReviewAssignmentConfigDto> {
    const config = await this.configService.getTicketAssignmentConfig();
    return {
      rules: config.rules.map((rule) => ({
        type: TICKET_TYPES.includes(rule.type as (typeof TICKET_TYPES)[number])
          ? (rule.type as (typeof TICKET_TYPES)[number])
          : undefined,
        priority: TICKET_PRIORITIES.includes(rule.priority as (typeof TICKET_PRIORITIES)[number])
          ? (rule.priority as (typeof TICKET_PRIORITIES)[number])
          : undefined,
        assigneeUserIds: [...rule.assigneeUserIds],
      })),
    };
  }

  async updateAssignmentConfig(
    body: SetTicketReviewAssignmentConfigDto,
    reviewerUserId: string,
    request?: Request,
  ): Promise<TicketReviewAssignmentConfigDto> {
    const normalizedRules = body.rules
      .map((rule) => ({
        type: rule.type || undefined,
        priority: rule.priority || undefined,
        assigneeUserIds: Array.from(
          new Set(rule.assigneeUserIds.map((item) => item.trim()).filter((item) => item.length > 0)),
        ),
      }))
      .filter((rule) => rule.assigneeUserIds.length > 0 && (rule.type || rule.priority));

    await this.configService.setTicketAssignmentConfig({ rules: normalizedRules }, reviewerUserId, request);
    return { rules: normalizedRules };
  }

  private async requireOwnedTicket(id: string, userId: string): Promise<TicketWithRelations> {
    const ticket = await this.repository.findByIdWithRelations(id);
    if (!ticket) throw new NotFoundError("工单不存在");
    if (ticket.userId !== userId) throw new ForbiddenError("无权访问该工单");
    return ticket;
  }

  private toListItemDto(item: TicketWithRelations): TicketListItemDto {
    return {
      id: item.id,
      userId: item.userId,
      username: item.user.username,
      type: item.type as TicketListItemDto["type"],
      title: item.title,
      workflowStatus: item.workflowStatus as TicketListItemDto["workflowStatus"],
      priority: item.priority as TicketListItemDto["priority"],
      assigneeUserId: item.assigneeUserId ?? undefined,
      assigneeUsername: item.assignee?.username ?? undefined,
      lastReplyAt: item.lastReplyAt?.toISOString(),
      createTime: item.createTime.toISOString(),
      updateTime: item.updateTime.toISOString(),
    };
  }

  private toDetailDto(item: TicketWithRelations, comments: TicketCommentWithAuthor[]): TicketDetailDto {
    return {
      ...this.toListItemDto(item),
      description: item.description,
      sourcePage: item.sourcePage ?? undefined,
      reproduceSteps: item.reproduceSteps ?? undefined,
      contactInfo: item.contactInfo ?? undefined,
      comments: comments.map((comment) => this.toCommentDto(comment)),
    };
  }

  private toCommentDto(
    comment: TicketCommentWithAuthor | (TicketComment & { author: { id: string; username: string } }),
  ): TicketCommentDto {
    return {
      id: comment.id,
      ticketId: comment.ticketId,
      authorUserId: comment.authorUserId,
      authorUsername: comment.author.username,
      visibility: comment.visibility as TicketCommentDto["visibility"],
      content: comment.content,
      createTime: comment.createTime.toISOString(),
      updateTime: comment.updateTime.toISOString(),
    };
  }

  private normalizeNullableText(value: string | null | undefined): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeNullableId(value: string | null | undefined): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private buildSelfUpdateInput(body: UpdateMyTicketDto): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(body, "type") && body.type !== undefined) data.type = body.type;
    if (Object.prototype.hasOwnProperty.call(body, "title") && body.title !== undefined) data.title = body.title.trim();
    if (Object.prototype.hasOwnProperty.call(body, "description") && body.description !== undefined)
      data.description = body.description.trim();
    if (Object.prototype.hasOwnProperty.call(body, "sourcePage"))
      data.sourcePage = this.normalizeNullableText(body.sourcePage);
    if (Object.prototype.hasOwnProperty.call(body, "reproduceSteps"))
      data.reproduceSteps = this.normalizeNullableText(body.reproduceSteps);
    if (Object.prototype.hasOwnProperty.call(body, "contactInfo"))
      data.contactInfo = this.normalizeNullableText(body.contactInfo);
    return data;
  }

  private pickMutableFields(ticket: Ticket | TicketWithRelations): Record<string, unknown> {
    return {
      type: ticket.type,
      title: ticket.title,
      description: ticket.description,
      sourcePage: ticket.sourcePage,
      reproduceSteps: ticket.reproduceSteps,
      contactInfo: ticket.contactInfo,
    };
  }

  private async resolveAutoAssigneeUserId(type: string, priority: string): Promise<string | null> {
    const config = await this.configService.getTicketAssignmentConfig();
    const matchedRule = this.selectAssignmentRule(config.rules, type, priority);
    if (!matchedRule) return null;

    const availableCandidates = await this.filterAssignableCandidates(matchedRule.assigneeUserIds);
    if (availableCandidates.length === 0) return null;

    return this.selectRoundRobinCandidate(type, priority, availableCandidates);
  }

  private selectAssignmentRule(
    rules: TicketAssignmentRule[],
    type: string,
    priority: string,
  ): TicketAssignmentRule | null {
    const exactMatch = rules.find((rule) => rule.type === type && rule.priority === priority);
    if (exactMatch) return exactMatch;

    const typeOnlyMatch = rules.find((rule) => rule.type === type && !rule.priority);
    if (typeOnlyMatch) return typeOnlyMatch;

    const priorityOnlyMatch = rules.find((rule) => !rule.type && rule.priority === priority);
    if (priorityOnlyMatch) return priorityOnlyMatch;

    return rules.find((rule) => !rule.type && !rule.priority) ?? null;
  }

  private async filterAssignableCandidates(userIds: string[]): Promise<string[]> {
    const uniqueUserIds = Array.from(new Set(userIds.map((item) => item.trim()).filter(Boolean)));

    const results = await Promise.all(
      uniqueUserIds.map(async (candidateUserId) => {
        const [user, hasPermission] = await Promise.all([
          this.userRepository.findActiveById(candidateUserId),
          this.permissionService.hasPermission(candidateUserId, Permission.TICKET_REVIEW_UPDATE),
        ]);

        return { candidateUserId, user, hasPermission };
      }),
    );

    return results.filter((item) => item.user && item.hasPermission).map((item) => item.candidateUserId);
  }

  private async selectRoundRobinCandidate(type: string, priority: string, candidateUserIds: string[]): Promise<string> {
    if (candidateUserIds.length === 1) return candidateUserIds[0];

    const cursorKey = this.getAssignmentCursorKey(type, priority, candidateUserIds);
    const cursorValue = await this.redisService.get(cursorKey);
    const parsedCursor = Number.parseInt(String(cursorValue ?? "0"), 10);
    const currentIndex = Number.isFinite(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
    const selectedIndex = currentIndex % candidateUserIds.length;
    const nextIndex = (selectedIndex + 1) % candidateUserIds.length;

    await this.redisService.set(cursorKey, nextIndex, TICKET_ASSIGNMENT_CURSOR_TTL_SECONDS);
    return candidateUserIds[selectedIndex];
  }

  private getAssignmentCursorKey(type: string, priority: string, candidateUserIds: string[]): string {
    const normalizedType = String(type || "*").trim() || "*";
    const normalizedPriority = String(priority || "*").trim() || "*";
    const normalizedCandidates = candidateUserIds.join(",");
    return `ticket:assignment:cursor:${normalizedType}:${normalizedPriority}:${normalizedCandidates}`;
  }

  private async notifyPendingReviewUsers(
    ticketId: string,
    title: string,
    priority: string,
    submitterUserId: string,
  ): Promise<void> {
    const recipients = await this.listTicketReviewRecipients(submitterUserId);
    if (recipients.length === 0) return;

    await Promise.allSettled(
      recipients.map((userId) =>
        this.notificationService.dispatch(userId, NotificationEvent.TICKET_PENDING_REVIEW, {
          subject: "有新工单等待分诊",
          summary: `新工单《${title}》等待具备处理权限的人员跟进`,
          ticketId,
          priority,
        }),
      ),
    );
  }

  private async listTicketReviewRecipients(excludeUserId?: string): Promise<string[]> {
    const activeUsers = (await this.userRepository.listNonDeleted()).filter(
      (user) => user.status === AccountStatus.ACTIVE && user.id !== excludeUserId,
    );

    const permissionResults = await Promise.all(
      activeUsers.map(async (user) => ({
        userId: user.id,
        hasPermission: await this.permissionService.hasPermission(user.id, Permission.TICKET_REVIEW_UPDATE),
      })),
    );

    return permissionResults.filter((item) => item.hasPermission).map((item) => item.userId);
  }
}
