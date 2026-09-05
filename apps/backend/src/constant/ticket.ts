import type { TicketWorkflowStatus, TicketPriority } from "@quyan/shared";
import {
  TICKET_TYPES,
  TICKET_WORKFLOW_STATUSES,
  TICKET_PRIORITIES,
  TICKET_COMMENT_VISIBILITIES,
  isTicketTerminalStatus,
} from "@quyan/shared";
export {
  TICKET_TYPES,
  TICKET_WORKFLOW_STATUSES,
  TICKET_PRIORITIES,
  TICKET_COMMENT_VISIBILITIES,
  isTicketTerminalStatus,
};
export type { TicketType, TicketWorkflowStatus, TicketPriority, TicketCommentVisibility } from "@quyan/shared";

export const DEFAULT_TICKET_WORKFLOW_STATUS: TicketWorkflowStatus = "pending";
export const DEFAULT_TICKET_PRIORITY: TicketPriority = "medium";
