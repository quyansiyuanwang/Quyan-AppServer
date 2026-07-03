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
  FeedbackReviewListQueryDto,
  ReviewFeedbackDto,
  UpdateMyFeedbackDto,
} from "@/api/dto/feedback/feedback.dto";
import {
  DEFAULT_FEEDBACK_PRIORITY,
  DEFAULT_FEEDBACK_WORKFLOW_STATUS,
  isFeedbackTerminalStatus,
} from "@/constant/feedback";
import { NotificationEvent } from "@/constant/notification-event";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import BusinessLogService from "@/services/system/businesslog.service";
import { NotificationService } from "@/services/notification/notification.service";
import { FeedbackRepository } from "@/store/feedback/feedback.repository";
import type { FeedbackCommentWithAuthor, FeedbackStore, FeedbackWithRelations } from "@/store/feedback/feedback.store";
import { UserRepository } from "@/store/users/user.repository";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";

const INTERNAL_VISIBILITY = "internal";
const PUBLIC_VISIBILITY = "public";

export class FeedbackService {
  private static instance: FeedbackService | null = null;

  private constructor(
    private readonly repository: FeedbackStore = FeedbackRepository.getInstance(),
    private readonly userRepository: UserRepository = UserRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly notificationService: NotificationService = NotificationService.getInstance(),
  ) {}

  static getInstance(): FeedbackService {
    if (!this.instance) this.instance = new FeedbackService();
    return this.instance;
  }

  async createFeedback(userId: string, body: CreateFeedbackDto, request?: Request): Promise<FeedbackDetailDto> {
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
}
