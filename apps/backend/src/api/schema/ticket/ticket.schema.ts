import { z } from "zod";
import {
  TICKET_COMMENT_VISIBILITIES,
  TICKET_PRIORITIES,
  TICKET_TYPES,
  TICKET_WORKFLOW_STATUSES,
} from "@/constant/ticket";

const ticketTypeSchema = z.enum(TICKET_TYPES);
const ticketWorkflowStatusSchema = z.enum(TICKET_WORKFLOW_STATUSES);
const ticketPrioritySchema = z.enum(TICKET_PRIORITIES);
const ticketCommentVisibilitySchema = z.enum(TICKET_COMMENT_VISIBILITIES);

const optionalShortTextSchema = z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional();
const optionalContactSchema = z.union([z.string().trim().max(200), z.literal(""), z.null()]).optional();
const optionalLongTextSchema = z.union([z.string().trim().max(5000), z.literal(""), z.null()]).optional();

export const ticketIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const createTicketBodySchema = z.object({
  type: ticketTypeSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  sourcePage: optionalShortTextSchema,
  reproduceSteps: optionalLongTextSchema,
  contactInfo: optionalContactSchema,
});

export const updateMyTicketBodySchema = z.object({
  type: ticketTypeSchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  sourcePage: optionalShortTextSchema,
  reproduceSteps: optionalLongTextSchema,
  contactInfo: optionalContactSchema,
});

export const createTicketCommentBodySchema = z.object({
  content: z.string().trim().min(1).max(5000),
});

export const createTicketReviewCommentBodySchema = z.object({
  content: z.string().trim().min(1).max(5000),
  visibility: ticketCommentVisibilitySchema,
});

export const ticketListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  keyword: z.string().trim().max(200).optional(),
  workflowStatus: ticketWorkflowStatusSchema.optional(),
  type: ticketTypeSchema.optional(),
});

export const ticketReviewListQuerySchema = ticketListQuerySchema.extend({
  priority: ticketPrioritySchema.optional(),
  assigneeUserId: z.string().trim().max(100).optional(),
  userId: z.string().trim().max(100).optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
});

export const reviewTicketBodySchema = z
  .object({
    workflowStatus: ticketWorkflowStatusSchema.optional(),
    priority: ticketPrioritySchema.optional(),
    assigneeUserId: z.union([z.string().trim().min(1).max(100), z.literal(""), z.null()]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const ticketAssignmentRuleSchema = z
  .object({
    type: ticketTypeSchema.optional(),
    priority: ticketPrioritySchema.optional(),
    assigneeUserIds: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  })
  .refine((value) => Boolean(value.type || value.priority), {
    message: "At least one matching condition is required",
  });

export const setTicketAssignmentConfigBodySchema = z.object({
  rules: z.array(ticketAssignmentRuleSchema).max(100),
});
