import { z } from "zod";
import {
  FEEDBACK_COMMENT_VISIBILITIES,
  FEEDBACK_PRIORITIES,
  FEEDBACK_TYPES,
  FEEDBACK_WORKFLOW_STATUSES,
} from "@/constant/feedback";

const feedbackTypeSchema = z.enum(FEEDBACK_TYPES);
const feedbackWorkflowStatusSchema = z.enum(FEEDBACK_WORKFLOW_STATUSES);
const feedbackPrioritySchema = z.enum(FEEDBACK_PRIORITIES);
const feedbackCommentVisibilitySchema = z.enum(FEEDBACK_COMMENT_VISIBILITIES);

const optionalShortTextSchema = z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional();
const optionalContactSchema = z.union([z.string().trim().max(200), z.literal(""), z.null()]).optional();
const optionalLongTextSchema = z.union([z.string().trim().max(5000), z.literal(""), z.null()]).optional();

export const feedbackIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const createFeedbackBodySchema = z.object({
  type: feedbackTypeSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  sourcePage: optionalShortTextSchema,
  reproduceSteps: optionalLongTextSchema,
  contactInfo: optionalContactSchema,
});

export const updateMyFeedbackBodySchema = z.object({
  type: feedbackTypeSchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  sourcePage: optionalShortTextSchema,
  reproduceSteps: optionalLongTextSchema,
  contactInfo: optionalContactSchema,
});

export const createFeedbackCommentBodySchema = z.object({
  content: z.string().trim().min(1).max(5000),
});

export const createFeedbackReviewCommentBodySchema = z.object({
  content: z.string().trim().min(1).max(5000),
  visibility: feedbackCommentVisibilitySchema,
});

export const feedbackListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  keyword: z.string().trim().max(200).optional(),
  workflowStatus: feedbackWorkflowStatusSchema.optional(),
  type: feedbackTypeSchema.optional(),
});

export const feedbackReviewListQuerySchema = feedbackListQuerySchema.extend({
  priority: feedbackPrioritySchema.optional(),
  assigneeUserId: z.string().trim().max(100).optional(),
  userId: z.string().trim().max(100).optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
});

export const reviewFeedbackBodySchema = z
  .object({
    workflowStatus: feedbackWorkflowStatusSchema.optional(),
    priority: feedbackPrioritySchema.optional(),
    assigneeUserId: z.union([z.string().trim().min(1).max(100), z.literal(""), z.null()]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });
