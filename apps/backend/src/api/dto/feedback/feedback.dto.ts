import type {
  FeedbackCommentVisibility,
  FeedbackPriority,
  FeedbackType,
  FeedbackWorkflowStatus,
} from "@/constant/feedback";

export interface CreateFeedbackDto {
  type: FeedbackType;
  title: string;
  description: string;
  sourcePage?: string;
  reproduceSteps?: string;
  contactInfo?: string;
}

export interface UpdateMyFeedbackDto {
  type?: FeedbackType;
  title?: string;
  description?: string;
  sourcePage?: string | null;
  reproduceSteps?: string | null;
  contactInfo?: string | null;
}

export interface ReviewFeedbackDto {
  workflowStatus?: FeedbackWorkflowStatus;
  priority?: FeedbackPriority;
  assigneeUserId?: string | null;
}

export interface CreateFeedbackCommentDto {
  content: string;
}

export interface CreateFeedbackReviewCommentDto {
  content: string;
  visibility: FeedbackCommentVisibility;
}

export interface FeedbackListQueryDto {
  page?: number;
  pageSize?: number;
  keyword?: string;
  workflowStatus?: FeedbackWorkflowStatus;
  type?: FeedbackType;
}

export interface FeedbackReviewListQueryDto extends FeedbackListQueryDto {
  priority?: FeedbackPriority;
  assigneeUserId?: string;
  userId?: string;
  startTime?: string;
  endTime?: string;
}

export interface FeedbackCommentDto {
  id: string;
  feedbackId: string;
  authorUserId: string;
  authorUsername?: string;
  visibility: FeedbackCommentVisibility;
  content: string;
  createTime: string;
  updateTime: string;
}

export interface FeedbackListItemDto {
  id: string;
  userId: string;
  username?: string;
  type: FeedbackType;
  title: string;
  workflowStatus: FeedbackWorkflowStatus;
  priority: FeedbackPriority;
  assigneeUserId?: string;
  assigneeUsername?: string;
  lastReplyAt?: string;
  createTime: string;
  updateTime: string;
}

export interface FeedbackDetailDto extends FeedbackListItemDto {
  description: string;
  sourcePage?: string;
  reproduceSteps?: string;
  contactInfo?: string;
  comments: FeedbackCommentDto[];
}

export interface FeedbackListResponseDto {
  items: FeedbackListItemDto[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
