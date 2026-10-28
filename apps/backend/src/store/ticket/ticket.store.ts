import type { Ticket, TicketComment } from "@prisma/client";

export interface TicketListFilters {
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

export interface TicketCreateInput {
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

export interface TicketUpdateInput {
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

export interface TicketCommentCreateInput {
  ticketId: string;
  authorUserId: string;
  visibility: string;
  content: string;
}

export interface TicketWithRelations extends Ticket {
  user: {
    id: string;
    username: string;
  };
  assignee: {
    id: string;
    username: string;
  } | null;
}

export interface TicketCommentWithAuthor extends TicketComment {
  author: {
    id: string;
    username: string;
  };
}

/** Metadata contains no title, body, contact details or comments. */
export type OwnTicketTarget = Pick<
  Ticket,
  "id" | "userId" | "createTime" | "updateTime" | "lastReplyAt" | "workflowStatus"
>;
export interface OwnTicketDetail {
  ticket: TicketWithRelations;
  comments: TicketCommentWithAuthor[];
}

export interface TicketStore {
  findOwnTarget(id: string, userId: string, accountOwnerId: string): Promise<OwnTicketTarget | null>;
  scanOwnTargets(
    userId: string,
    accountOwnerId: string,
    filters: TicketListFilters,
    after?: OwnTicketTarget,
  ): Promise<OwnTicketTarget[]>;
  readOwnTargets(
    userId: string,
    accountOwnerId: string,
    targets: readonly OwnTicketTarget[],
  ): Promise<TicketWithRelations[]>;
  readOwnDetail(userId: string, accountOwnerId: string, target: OwnTicketTarget): Promise<OwnTicketDetail>;
  createInAccount(data: TicketCreateInput, accountOwnerId: string): Promise<Ticket>;
  updateOwnTarget(target: OwnTicketTarget, accountOwnerId: string, data: TicketUpdateInput): Promise<Ticket>;
  commentOwnTarget(
    target: OwnTicketTarget,
    accountOwnerId: string,
    data: TicketCommentCreateInput,
  ): Promise<TicketComment>;
  create(data: TicketCreateInput): Promise<Ticket>;
  findById(id: string): Promise<Ticket | null>;
  findByIdWithRelations(id: string): Promise<TicketWithRelations | null>;
  findCommentsByTicketId(ticketId: string): Promise<TicketCommentWithAuthor[]>;
  createComment(data: TicketCommentCreateInput): Promise<TicketComment>;
  update(id: string, data: TicketUpdateInput): Promise<Ticket>;
  delete(id: string): Promise<Ticket>;
  findMyList(userId: string, filters: TicketListFilters): Promise<{ items: TicketWithRelations[]; total: number }>;
  findReviewList(filters: TicketListFilters): Promise<{ items: TicketWithRelations[]; total: number }>;
}
