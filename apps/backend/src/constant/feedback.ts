import type { FeedbackWorkflowStatus, FeedbackPriority } from '@appserver/shared';
import {
  FEEDBACK_TYPES,
  FEEDBACK_WORKFLOW_STATUSES,
  FEEDBACK_PRIORITIES,
  FEEDBACK_COMMENT_VISIBILITIES,
  isFeedbackTerminalStatus,
} from '@appserver/shared';
export {
  FEEDBACK_TYPES,
  FEEDBACK_WORKFLOW_STATUSES,
  FEEDBACK_PRIORITIES,
  FEEDBACK_COMMENT_VISIBILITIES,
  isFeedbackTerminalStatus,
};
export type { FeedbackType, FeedbackWorkflowStatus, FeedbackPriority, FeedbackCommentVisibility } from '@appserver/shared';

export const DEFAULT_FEEDBACK_WORKFLOW_STATUS: FeedbackWorkflowStatus = 'pending';
export const DEFAULT_FEEDBACK_PRIORITY: FeedbackPriority = 'medium';
