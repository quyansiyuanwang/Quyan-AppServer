export const FEEDBACK_TYPES = ['suggestion', 'bug', 'other'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_WORKFLOW_STATUSES = ['pending', 'processing', 'accepted', 'rejected', 'completed'] as const;
export type FeedbackWorkflowStatus = (typeof FEEDBACK_WORKFLOW_STATUSES)[number];

export const FEEDBACK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

export const FEEDBACK_COMMENT_VISIBILITIES = ['public', 'internal'] as const;
export type FeedbackCommentVisibility = (typeof FEEDBACK_COMMENT_VISIBILITIES)[number];

export function isFeedbackTerminalStatus(status: string): boolean {
  return status === 'rejected' || status === 'completed';
}
