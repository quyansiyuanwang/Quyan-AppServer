import { z } from "zod";

const date = z
  .string()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be a valid date");

export const clientErrorReportBodySchema = z.object({
  errorType: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(4000),
  route: z.string().trim().max(1024).optional(),
  severity: z.enum(["error", "fatal", "warning"]).optional(),
  requestId: z.string().trim().max(128).optional(),
  httpMethod: z.string().trim().max(12).optional(),
  httpStatus: z.number().int().min(0).max(599).optional(),
  clientVersion: z.string().trim().max(128).optional(),
  stack: z.string().max(8000).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const clientErrorReportBatchBodySchema = z.object({
  reports: z.array(clientErrorReportBodySchema).min(1).max(10),
});

export const errorGroupsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  resolutionStatus: z.enum(["open", "acknowledged", "resolved", "ignored"]).optional(),
  source: z.enum(["frontend", "backend"]).optional(),
  search: z.string().trim().max(200).optional(),
  startDate: date.optional(),
  endDate: date.optional(),
});

export const errorGroupIdParamsSchema = z.object({ id: z.string().trim().min(1).max(191) });
export const updateErrorGroupStatusBodySchema = z.object({
  resolutionStatus: z.enum(["open", "acknowledged", "resolved", "ignored"]),
});
export const errorOccurrencesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
