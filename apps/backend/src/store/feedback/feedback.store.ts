import type { Feedback, FeedbackComment } from "@prisma/client";

export interface FeedbackListFilters {
  page: number;
  pageSize: number;
  keyword?: string;
  workflowStatus?: string;
  type?: string;
  priority?: string;
  assigneeUserId?: string;
  userId?: string;
  startTime?: Date;
  endTime?: Date;
}

export interface FeedbackCreateInput {
  userId: string;
  type: string;
  title: string;
  description: string;
  sourcePage?: string | null;
  reproduceSteps?: string | null;
  contactInfo?: string | null;
  workflowStatus: string;
  priority: string;
  assigneeUserId?: string | null;
}

export interface FeedbackUpdateInput {
  type?: string;
  title?: string;
  description?: string;
  sourcePage?: string | null;
  reproduceSteps?: string | null;
  contactInfo?: string | null;
  workflowStatus?: string;
  priority?: string;
  assigneeUserId?: string | null;
  lastReplyAt?: Date | null;
}

export interface FeedbackCommentCreateInput {
  feedbackId: string;
  authorUserId: string;
  visibility: string;
  content: string;
}

export interface FeedbackWithRelations extends Feedback {
  user: {
    id: string;
    username: string;
  };
  assignee: {
    id: string;
    username: string;
  } | null;
}

export interface FeedbackCommentWithAuthor extends FeedbackComment {
  author: {
    id: string;
    username: string;
  };
}

export interface FeedbackStore {
  create(data: FeedbackCreateInput): Promise<Feedback>;
  findById(id: string): Promise<Feedback | null>;
  findByIdWithRelations(id: string): Promise<FeedbackWithRelations | null>;
  findCommentsByFeedbackId(feedbackId: string): Promise<FeedbackCommentWithAuthor[]>;
  createComment(data: FeedbackCommentCreateInput): Promise<FeedbackComment>;
  update(id: string, data: FeedbackUpdateInput): Promise<Feedback>;
  delete(id: string): Promise<Feedback>;
  findMyList(userId: string, filters: FeedbackListFilters): Promise<{ items: FeedbackWithRelations[]; total: number }>;
  findReviewList(filters: FeedbackListFilters): Promise<{ items: FeedbackWithRelations[]; total: number }>;
}
