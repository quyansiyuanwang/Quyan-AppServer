import type { Feedback, FeedbackComment } from "@prisma/client";
import type { Request } from "express";
import type {
  CreateFeedbackCommentDto,
  CreateFeedbackDto,
  CreateFeedbackReviewCommentDto,
  FeedbackCommentDto,
  FeedbackDetailDto,
  FeedbackListItemDto,
  FeedbackListQueryDto,
  FeedbackListResponseDto,
  FeedbackReviewAssignmentConfigDto,
  FeedbackReviewListQueryDto,
  ReviewFeedbackDto,
  SetFeedbackReviewAssignmentConfigDto,
  UpdateMyFeedbackDto,
} from "@/api/dto/feedback/feedback.dto";
import {
  DEFAULT_FEEDBACK_PRIORITY,
  FEEDBACK_PRIORITIES,
  FEEDBACK_TYPES,
  DEFAULT_FEEDBACK_WORKFLOW_STATUS,
  isFeedbackTerminalStatus,
} from "@/constant/feedback";
import { NotificationEvent } from "@/constant/notification-event";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { Permission } from "@/constant/permission";
import BusinessLogService from "@/services/system/businesslog.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import { NotificationService } from "@/services/notification/notification.service";
import { ConfigService, type FeedbackAssignmentRule } from "@/services/system/config.service";
import { PermissionService } from "@/services/users/permission.service";
import { FeedbackRepository } from "@/store/feedback/feedback.repository";
import type { FeedbackCommentWithAuthor, FeedbackStore, FeedbackWithRelations } from "@/store/feedback/feedback.store";
import { UserRepository } from "@/store/users/user.repository";
import { AccountStatus } from "@/util/auth/account-status";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";

const INTERNAL_VISIBILITY = "internal";
const PUBLIC_VISIBILITY = "public";
const FEEDBACK_ASSIGNMENT_CURSOR_TTL_SECONDS = 60 * 60 * 24 * 30;

export class FeedbackService {
  private static instance: FeedbackService | null = null;

  private constructor(
    private readonly repository: FeedbackStore = FeedbackRepository.getInstance(),
    private readonly userRepository: UserRepository = UserRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly notificationService: NotificationService = NotificationService.getInstance(),
    private readonly configService: ConfigService = ConfigService.getInstance(),
    private readonly permissionService: PermissionService = PermissionService.getInstance(),
    private readonly redisService: RedisService = RedisService.getInstance(),
  ) {}

  static getInstance(): FeedbackService {
    if (!this.instance) this.instance = new FeedbackService();
    return this.instance;
  }

  async createFeedback(userId: string, body: CreateFeedbackDto, request?: Request): Promise<FeedbackDetailDto> {
    const autoAssigneeUserId = await this.resolveAutoAssigneeUserId(body.type, DEFAULT_FEEDBACK_PRIORITY);

    const created = await this.repository.create({
      userId,
      type: body.type,
      title: body.title.trim(),
      description: body.description.trim(),
      sourcePage: this.normalizeNullableText(body.sourcePage),
      reproduceSteps: this.normalizeNullableText(body.reproduceSteps),
      contactInfo: this.normalizeNullableText(body.contactInfo),
      workflowStatus: DEFAULT_FEEDBACK_WORKFLOW_STATUS,
      priority: DEFAULT_FEEDBACK_PRIORITY,
      assigneeUserId: autoAssigneeUserId ?? undefined,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.FEEDBACK_CREATE,
      operationCategory: OperationCategory.SYSTEM,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: created.id,
      targetResourceType: "FEEDBACK",
      description: `提交反馈 '${created.title}'`,
      changes: { type: created.type, priority: created.priority },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    if (autoAssigneeUserId && autoAssigneeUserId !== userId)
      await this.notificationService.dispatch(autoAssigneeUserId, NotificationEvent.FEEDBACK_ASSIGNED, {
        title: "你有新的工单待处理",
        content: `工单《${created.title}》已自动分配给你`,
        data: { feedbackId: created.id, priority: created.priority, autoAssigned: true },
      });
    else await this.notifyPendingReviewUsers(created.id, created.title, created.priority, userId);

    return this.getMyFeedbackDetail(created.id, userId);
  }

  async listMyFeedback(userId: string, query: FeedbackListQueryDto): Promise<FeedbackListResponseDto> {
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

  async getMyFeedbackDetail(id: string, userId: string): Promise<FeedbackDetailDto> {
    const feedback = await this.requireOwnedFeedback(id, userId);
    const comments = await this.repository.findCommentsByFeedbackId(id);
    return this.toDetailDto(
      feedback,
      comments.filter((item) => item.visibility !== INTERNAL_VISIBILITY),
    );
  }

  async updateMyFeedback(
    id: string,
    userId: string,
    body: UpdateMyFeedbackDto,
    request?: Request,
  ): Promise<FeedbackDetailDto> {
    const existing = await this.requireOwnedFeedback(id, userId);
    if (isFeedbackTerminalStatus(existing.workflowStatus)) throw new BadRequestError("当前反馈已结束，不能再修改");

    const updateData = this.buildSelfUpdateInput(body);
    if (Object.keys(updateData).length === 0) return this.getMyFeedbackDetail(id, userId);

    const updated = await this.repository.update(id, updateData);

    await this.businessLogService.logOperation({
      operationType: OperationType.FEEDBACK_UPDATE,
      operationCategory: OperationCategory.SYSTEM,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: updated.id,
      targetResourceType: "FEEDBACK",
      description: `更新反馈 '${updated.title}'`,
      changes: { before: this.pickMutableFields(existing), after: this.pickMutableFields(updated) },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.getMyFeedbackDetail(id, userId);
  }

  async addMyComment(
    id: string,
    userId: string,
    body: CreateFeedbackCommentDto,
    request?: Request,
  ): Promise<FeedbackCommentDto> {
    const feedback = await this.requireOwnedFeedback(id, userId);
    if (isFeedbackTerminalStatus(feedback.workflowStatus)) throw new BadRequestError("当前反馈已结束，不能再追加评论");

    const created = await this.repository.createComment({
      feedbackId: id,
      authorUserId: userId,
      visibility: PUBLIC_VISIBILITY,
      content: body.content.trim(),
    });

    await this.repository.update(id, { lastReplyAt: created.createTime });

    await this.businessLogService.logOperation({
      operationType: OperationType.FEEDBACK_COMMENT_CREATE,
      operationCategory: OperationCategory.SYSTEM,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: feedback.id,
      targetResourceType: "FEEDBACK",
      description: `为反馈 '${feedback.title}' 添加评论`,
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

  async listReviewFeedback(query: FeedbackReviewListQueryDto): Promise<FeedbackListResponseDto> {
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

  async getReviewFeedbackDetail(id: string): Promise<FeedbackDetailDto> {
    const feedback = await this.repository.findByIdWithRelations(id);
    if (!feedback) throw new NotFoundError("反馈不存在");
    const comments = await this.repository.findCommentsByFeedbackId(id);
    return this.toDetailDto(feedback, comments);
  }

  async reviewFeedback(
    id: string,
    reviewerUserId: string,
    body: ReviewFeedbackDto,
    request?: Request,
  ): Promise<FeedbackDetailDto> {
    const existing = await this.repository.findByIdWithRelations(id);
    if (!existing) throw new NotFoundError("反馈不存在");

    const updateData: Record<string, unknown> = {};
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

    if (Object.keys(updateData).length === 0) return this.getReviewFeedbackDetail(id);

    const updated = await this.repository.update(id, updateData);

    if (existing.workflowStatus !== updated.workflowStatus) {
      await this.businessLogService.logOperation({
        operationType: OperationType.FEEDBACK_STATUS_CHANGE,
        operationCategory: OperationCategory.SYSTEM,
        actorUserId: reviewerUserId,
        targetUserId: existing.userId,
        targetResourceId: updated.id,
        targetResourceType: "FEEDBACK",
        description: `更新反馈 '${updated.title}' 状态`,
        changes: { beforeStatus: existing.workflowStatus, afterStatus: updated.workflowStatus },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });

      if (existing.userId !== reviewerUserId)
        await this.notificationService.dispatch(existing.userId, NotificationEvent.FEEDBACK_STATUS_UPDATED, {
          title: "反馈状态已更新",
          content: `你的反馈《${updated.title}》状态已变更为 ${updated.workflowStatus}`,
          data: { feedbackId: updated.id, workflowStatus: updated.workflowStatus },
        });
    }

    if (existing.priority !== updated.priority)
      await this.businessLogService.logOperation({
        operationType: OperationType.FEEDBACK_PRIORITY_CHANGE,
        operationCategory: OperationCategory.SYSTEM,
        actorUserId: reviewerUserId,
        targetUserId: existing.userId,
        targetResourceId: updated.id,
        targetResourceType: "FEEDBACK",
        description: `更新反馈 '${updated.title}' 优先级`,
        changes: { beforePriority: existing.priority, afterPriority: updated.priority },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });

    if (existing.assigneeUserId !== updated.assigneeUserId) {
      await this.businessLogService.logOperation({
        operationType: OperationType.FEEDBACK_ASSIGN,
        operationCategory: OperationCategory.SYSTEM,
        actorUserId: reviewerUserId,
        targetUserId: existing.userId,
        targetResourceId: updated.id,
        targetResourceType: "FEEDBACK",
        description: `调整反馈 '${updated.title}' 处理人`,
        changes: { beforeAssigneeUserId: existing.assigneeUserId, afterAssigneeUserId: updated.assigneeUserId },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });

      if (updated.assigneeUserId && updated.assigneeUserId !== reviewerUserId)
        await this.notificationService.dispatch(updated.assigneeUserId, NotificationEvent.FEEDBACK_ASSIGNED, {
          title: "你有新的反馈工单待处理",
          content: `反馈《${updated.title}》已分配给你`,
          data: { feedbackId: updated.id, priority: updated.priority },
        });
    }

    return this.getReviewFeedbackDetail(id);
  }

  async addReviewComment(
    id: string,
    reviewerUserId: string,
    body: CreateFeedbackReviewCommentDto,
    request?: Request,
  ): Promise<FeedbackCommentDto> {
    const feedback = await this.repository.findByIdWithRelations(id);
    if (!feedback) throw new NotFoundError("反馈不存在");

    const created = await this.repository.createComment({
      feedbackId: id,
      authorUserId: reviewerUserId,
      visibility: body.visibility,
      content: body.content.trim(),
    });

    await this.repository.update(id, { lastReplyAt: created.createTime });

    await this.businessLogService.logOperation({
      operationType: OperationType.FEEDBACK_COMMENT_CREATE,
      operationCategory: OperationCategory.SYSTEM,
      actorUserId: reviewerUserId,
      targetUserId: feedback.userId,
      targetResourceId: feedback.id,
      targetResourceType: "FEEDBACK",
      description: `为反馈 '${feedback.title}' 添加${body.visibility === INTERNAL_VISIBILITY ? "内部" : "公开"}评论`,
      changes: { visibility: body.visibility },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    if (body.visibility === PUBLIC_VISIBILITY && feedback.userId !== reviewerUserId)
      await this.notificationService.dispatch(feedback.userId, NotificationEvent.FEEDBACK_PUBLIC_REPLY, {
        title: "你的反馈收到了新回复",
        content: `反馈《${feedback.title}》有新的处理回复`,
        data: { feedbackId: feedback.id },
      });

    return this.toCommentDto({
      ...created,
      author: {
        id: reviewerUserId,
        username: (await this.userRepository.findActiveUsernameById(reviewerUserId)) ?? reviewerUserId,
      },
    });
  }

  async deleteFeedback(id: string, reviewerUserId: string, request?: Request): Promise<void> {
    const feedback = await this.repository.findById(id);
    if (!feedback) throw new NotFoundError("反馈不存在");
    await this.repository.delete(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.FEEDBACK_DELETE,
      operationCategory: OperationCategory.SYSTEM,
      actorUserId: reviewerUserId,
      targetUserId: feedback.userId,
      targetResourceId: feedback.id,
      targetResourceType: "FEEDBACK",
      description: `删除反馈 '${feedback.title}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  async getAssignmentConfig(): Promise<FeedbackReviewAssignmentConfigDto> {
    const config = await this.configService.getFeedbackAssignmentConfig();
    return {
      rules: config.rules.map((rule) => ({
        type: FEEDBACK_TYPES.includes(rule.type as (typeof FEEDBACK_TYPES)[number])
          ? (rule.type as (typeof FEEDBACK_TYPES)[number])
          : undefined,
        priority: FEEDBACK_PRIORITIES.includes(rule.priority as (typeof FEEDBACK_PRIORITIES)[number])
          ? (rule.priority as (typeof FEEDBACK_PRIORITIES)[number])
          : undefined,
        assigneeUserIds: [...rule.assigneeUserIds],
      })),
    };
  }

  async updateAssignmentConfig(
    body: SetFeedbackReviewAssignmentConfigDto,
    reviewerUserId: string,
    request?: Request,
  ): Promise<FeedbackReviewAssignmentConfigDto> {
    const normalizedRules = body.rules
      .map((rule) => ({
        type: rule.type || undefined,
        priority: rule.priority || undefined,
        assigneeUserIds: Array.from(
          new Set(rule.assigneeUserIds.map((item) => item.trim()).filter((item) => item.length > 0)),
        ),
      }))
      .filter((rule) => rule.assigneeUserIds.length > 0 && (rule.type || rule.priority));

    await this.configService.setFeedbackAssignmentConfig({ rules: normalizedRules }, reviewerUserId, request);
    return { rules: normalizedRules };
  }

  private async requireOwnedFeedback(id: string, userId: string): Promise<FeedbackWithRelations> {
    const feedback = await this.repository.findByIdWithRelations(id);
    if (!feedback) throw new NotFoundError("反馈不存在");
    if (feedback.userId !== userId) throw new ForbiddenError("无权访问该反馈");
    return feedback;
  }

  private toListItemDto(item: FeedbackWithRelations): FeedbackListItemDto {
    return {
      id: item.id,
      userId: item.userId,
      username: item.user.username,
      type: item.type as FeedbackListItemDto["type"],
      title: item.title,
      workflowStatus: item.workflowStatus as FeedbackListItemDto["workflowStatus"],
      priority: item.priority as FeedbackListItemDto["priority"],
      assigneeUserId: item.assigneeUserId ?? undefined,
      assigneeUsername: item.assignee?.username ?? undefined,
      lastReplyAt: item.lastReplyAt?.toISOString(),
      createTime: item.createTime.toISOString(),
      updateTime: item.updateTime.toISOString(),
    };
  }

  private toDetailDto(item: FeedbackWithRelations, comments: FeedbackCommentWithAuthor[]): FeedbackDetailDto {
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
    comment: FeedbackCommentWithAuthor | (FeedbackComment & { author: { id: string; username: string } }),
  ): FeedbackCommentDto {
    return {
      id: comment.id,
      feedbackId: comment.feedbackId,
      authorUserId: comment.authorUserId,
      authorUsername: comment.author.username,
      visibility: comment.visibility as FeedbackCommentDto["visibility"],
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

  private buildSelfUpdateInput(body: UpdateMyFeedbackDto): Record<string, unknown> {
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

  private pickMutableFields(feedback: Feedback | FeedbackWithRelations): Record<string, unknown> {
    return {
      type: feedback.type,
      title: feedback.title,
      description: feedback.description,
      sourcePage: feedback.sourcePage,
      reproduceSteps: feedback.reproduceSteps,
      contactInfo: feedback.contactInfo,
    };
  }

  private async resolveAutoAssigneeUserId(type: string, priority: string): Promise<string | null> {
    const config = await this.configService.getFeedbackAssignmentConfig();
    const matchedRule = this.selectAssignmentRule(config.rules, type, priority);
    if (!matchedRule) return null;

    const availableCandidates = await this.filterAssignableCandidates(matchedRule.assigneeUserIds);
    if (availableCandidates.length === 0) return null;

    return this.selectRoundRobinCandidate(type, priority, availableCandidates);
  }

  private selectAssignmentRule(
    rules: FeedbackAssignmentRule[],
    type: string,
    priority: string,
  ): FeedbackAssignmentRule | null {
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
          this.permissionService.hasPermission(candidateUserId, Permission.FEEDBACK_REVIEW_UPDATE),
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

    await this.redisService.set(cursorKey, nextIndex, FEEDBACK_ASSIGNMENT_CURSOR_TTL_SECONDS);
    return candidateUserIds[selectedIndex];
  }

  private getAssignmentCursorKey(type: string, priority: string, candidateUserIds: string[]): string {
    const normalizedType = String(type || "*").trim() || "*";
    const normalizedPriority = String(priority || "*").trim() || "*";
    const normalizedCandidates = candidateUserIds.join(",");
    return `feedback:assignment:cursor:${normalizedType}:${normalizedPriority}:${normalizedCandidates}`;
  }

  private async notifyPendingReviewUsers(
    feedbackId: string,
    title: string,
    priority: string,
    submitterUserId: string,
  ): Promise<void> {
    const recipients = await this.listFeedbackReviewRecipients(submitterUserId);
    if (recipients.length === 0) return;

    await Promise.allSettled(
      recipients.map((userId) =>
        this.notificationService.dispatch(userId, NotificationEvent.FEEDBACK_PENDING_REVIEW, {
          title: "有新工单等待分诊",
          content: `新工单《${title}》等待具备处理权限的人员跟进`,
          data: { feedbackId, priority },
        }),
      ),
    );
  }

  private async listFeedbackReviewRecipients(excludeUserId?: string): Promise<string[]> {
    const activeUsers = (await this.userRepository.listNonDeleted()).filter(
      (user) => user.status === AccountStatus.ACTIVE && user.id !== excludeUserId,
    );

    const permissionResults = await Promise.all(
      activeUsers.map(async (user) => ({
        userId: user.id,
        hasPermission: await this.permissionService.hasPermission(user.id, Permission.FEEDBACK_REVIEW_UPDATE),
      })),
    );

    return permissionResults.filter((item) => item.hasPermission).map((item) => item.userId);
  }
}
