export const TICKET_TYPES = ['suggestion', 'bug', 'other'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_WORKFLOW_STATUSES = ['pending', 'processing', 'accepted', 'rejected', 'completed'] as const;
export type TicketWorkflowStatus = (typeof TICKET_WORKFLOW_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_COMMENT_VISIBILITIES = ['public', 'internal'] as const;
export type TicketCommentVisibility = (typeof TICKET_COMMENT_VISIBILITIES)[number];

export function isTicketTerminalStatus(status: string): boolean {
  return status === 'rejected' || status === 'completed';
}
