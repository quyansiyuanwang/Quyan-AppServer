import { z } from "zod";
import {
  AI_REQUEST_LOG_LIMITS,
  AI_REQUEST_LOG_OUTCOMES,
  AI_REQUEST_LOG_STAGES,
  AI_REQUEST_LOG_OMISSION_REASONS,
} from "@/constant/ai-request-log";
const optionalDate = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date")
  .optional();
const optionalBoolean = z
  .preprocess((value) => (value === "true" ? true : value === "false" ? false : value), z.boolean())
  .optional();
const pageSize = z.coerce.number().int().min(1).max(AI_REQUEST_LOG_LIMITS.maxPageItems).optional();
const cursor = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(2048)
  .optional();
const duration = z.coerce.number().int().min(0).max(2147483647).optional();
export const aiRequestLogListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    pageSize,
    user: z.string().trim().max(191).optional(),
    relayToken: z.string().trim().max(191).optional(),
    model: z.string().trim().max(160).optional(),
    requestFormat: z.string().trim().max(40).optional(),
    statusCode: z.coerce.number().int().min(100).max(599).optional(),
    requestId: z.string().trim().max(64).optional(),
    keyword: z.string().trim().max(500).optional(),
    truncated: optionalBoolean,
    startDate: optionalDate,
    endDate: optionalDate,
    outcome: z.enum(AI_REQUEST_LOG_OUTCOMES).optional(),
    failureStage: z.enum(AI_REQUEST_LOG_STAGES).optional(),
    bodyOmissionReason: z.enum(AI_REQUEST_LOG_OMISSION_REASONS).optional(),
    isStreaming: optionalBoolean,
    ipAddress: z.string().trim().max(128).optional(),
    minDurationMs: duration,
    maxDurationMs: duration,
  })
  .refine((value) => !value.startDate || !value.endDate || Date.parse(value.startDate) <= Date.parse(value.endDate), {
    message: "Start date must not exceed end date",
    path: ["endDate"],
  })
  .refine(
    (value) =>
      value.minDurationMs === undefined ||
      value.maxDurationMs === undefined ||
      value.minDurationMs <= value.maxDurationMs,
    { message: "Minimum duration must not exceed maximum duration", path: ["maxDurationMs"] },
  );
export const aiRequestLogParamsSchema = z.object({ id: z.string().trim().min(1).max(191) });
export const aiRequestLogContentQuerySchema = z.object({
  side: z.enum(["request", "response"]).optional(),
  view: z.enum(["parsed", "raw"]).optional(),
  cursor,
  locator: cursor,
  pageSize,
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .max(AI_REQUEST_LOG_LIMITS.responseBodyBytes * 8)
    .optional(),
});
export const aiRequestLogSearchQuerySchema = z.object({
  scope: z.enum(["request", "response", "attempts"]).optional(),
  keyword: z.string().trim().min(1).max(500),
  cursor,
  pageSize,
});
export const aiRequestLogAttemptsQuerySchema = z.object({ cursor, pageSize });
