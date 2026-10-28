import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import type { TicketReviewReadTarget, TicketReviewCommentTarget } from "./platform-ticket-review-read.store";
import type { OwnTicketDetail, TicketWithRelations, TicketCommentWithAuthor, TicketUpdateInput } from "./ticket.store";
export type TicketReviewMutationAction =
  | "quyan:ticket:UpdateReviewTicket"
  | "quyan:ticket:AddReviewComment"
  | "quyan:ticket:DeleteReviewTicket";
export type TicketReviewMutationInput =
  | { kind: "update"; data: Pick<TicketUpdateInput, "type" | "workflowStatus" | "priority" | "assigneeUserId"> }
  | { kind: "comment"; data: { content: string; visibility: "public" | "internal" } }
  | { kind: "delete" };
export interface TicketReviewMutationGuard {
  action: TicketReviewMutationAction;
  target: TicketReviewReadTarget;
  comments: readonly TicketReviewCommentTarget[];
  group: PlatformManagementReadSnapshot["group"];
  authorizationRevision: string;
  users: IamAccountUserMutationGuard;
}
export interface TicketReviewMutationResult {
  before: TicketWithRelations;
  detail?: OwnTicketDetail;
  comment?: TicketCommentWithAuthor;
}
export interface PlatformTicketReviewMutationStore {
  target(principal: IamPrincipal, id: string): Promise<TicketReviewReadTarget | null>;
  comments(principal: IamPrincipal, target: TicketReviewReadTarget): Promise<TicketReviewCommentTarget[]>;
  authorizationRevision(principal: IamPrincipal): Promise<string>;
  mutate(guard: TicketReviewMutationGuard, input: TicketReviewMutationInput): Promise<TicketReviewMutationResult>;
}
