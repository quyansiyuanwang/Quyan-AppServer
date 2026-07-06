import type { TicketCommentVisibility, TicketPriority, TicketType, TicketWorkflowStatus } from "@/constant/ticket";

export interface CreateTicketDto {
  type: TicketType;
  title: string;
  description: string;
  sourcePage?: string;
  reproduceSteps?: string;
  contactInfo?: string;
}

export interface UpdateMyTicketDto {
  type?: TicketType;
  title?: string;
  description?: string;
  sourcePage?: string | null;
  reproduceSteps?: string | null;
  contactInfo?: string | null;
}

export interface ReviewTicketDto {
  workflowStatus?: TicketWorkflowStatus;
  priority?: TicketPriority;
  assigneeUserId?: string | null;
}

export interface CreateTicketCommentDto {
  content: string;
}

export interface CreateTicketReviewCommentDto {
  content: string;
  visibility: TicketCommentVisibility;
}

export interface TicketListQueryDto {
  page?: number;
  pageSize?: number;
  keyword?: string;
  workflowStatus?: TicketWorkflowStatus;
  type?: TicketType;
}

export interface TicketReviewListQueryDto extends TicketListQueryDto {
  priority?: TicketPriority;
  assigneeUserId?: string;
  userId?: string;
  startTime?: string;
  endTime?: string;
}

export interface TicketCommentDto {
  id: string;
  ticketId: string;
  authorUserId: string;
  authorUsername?: string;
  visibility: TicketCommentVisibility;
  content: string;
  createTime: string;
  updateTime: string;
}

export interface TicketListItemDto {
  id: string;
  userId: string;
  username?: string;
  type: TicketType;
  title: string;
  workflowStatus: TicketWorkflowStatus;
  priority: TicketPriority;
  assigneeUserId?: string;
  assigneeUsername?: string;
  lastReplyAt?: string;
  createTime: string;
  updateTime: string;
}

export interface TicketDetailDto extends TicketListItemDto {
  description: string;
  sourcePage?: string;
  reproduceSteps?: string;
  contactInfo?: string;
  comments: TicketCommentDto[];
}

export interface TicketListResponseDto {
  items: TicketListItemDto[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface TicketReviewAssignmentRuleDto {
  type?: TicketType;
  priority?: TicketPriority;
  assigneeUserIds: string[];
}

export interface TicketReviewAssignmentConfigDto {
  rules: TicketReviewAssignmentRuleDto[];
}

export interface SetTicketReviewAssignmentConfigDto {
  rules: TicketReviewAssignmentRuleDto[];
}
