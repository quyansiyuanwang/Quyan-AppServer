import { z } from "zod";

const SYSTEM_QUERY_MAX_RANGE_DAYS = 30;
const SYSTEM_QUERY_MAX_RANGE_MS = SYSTEM_QUERY_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;

const validDateString = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
};

const validateDateRange = (value: { startDate?: string; endDate?: string }, ctx: z.RefinementCtx): void => {
  if (!value.startDate || !value.endDate) return;

  const startDate = Date.parse(value.startDate);
  const endDate = Date.parse(value.endDate);

  if (Number.isNaN(startDate) || Number.isNaN(endDate)) return;

  if (startDate > endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "startDate must be less than or equal to endDate",
    });
    return;
  }

  if (endDate - startDate <= SYSTEM_QUERY_MAX_RANGE_MS) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["endDate"],
    message: `date range cannot exceed ${SYSTEM_QUERY_MAX_RANGE_DAYS} days`,
  });
};

const normalizeToArray = (value: unknown): unknown[] | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  return Array.isArray(value) ? value : [value];
};

export const systemLogsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    user: z.string().max(200).optional(),
    requestID: z.string().max(100).optional(),
    path: z.string().max(200).optional(),
    ip: z.string().max(45).optional(),
    method: z.preprocess(normalizeToArray, z.array(z.string().trim().min(1)).max(20).optional()),
    statusCode: z.preprocess(normalizeToArray, z.array(z.coerce.number().int().min(100).max(599)).max(20).optional()),
    startDate: z
      .string()
      .max(40)
      .refine((value) => validDateString(value), "startDate must be a valid date string")
      .optional(),
    endDate: z
      .string()
      .max(40)
      .refine((value) => validDateString(value), "endDate must be a valid date string")
      .optional(),
    search: z.string().max(500).optional(),
  })
  .superRefine(validateDateRange);

export const systemLogStatsQuerySchema = z
  .object({
    user: z.string().max(200).optional(),
    requestID: z.string().max(100).optional(),
    path: z.string().max(200).optional(),
    ip: z.string().max(45).optional(),
    method: z.preprocess(normalizeToArray, z.array(z.string().trim().min(1)).max(20).optional()),
    statusCode: z.preprocess(normalizeToArray, z.array(z.coerce.number().int().min(100).max(599)).max(20).optional()),
    startDate: z
      .string()
      .max(40)
      .refine((value) => validDateString(value), "startDate must be a valid date string")
      .optional(),
    endDate: z
      .string()
      .max(40)
      .refine((value) => validDateString(value), "endDate must be a valid date string")
      .optional(),
    search: z.string().max(500).optional(),
  })
  .superRefine(validateDateRange);

export const systemLogDetailParamsSchema = z.object({
  logId: z.string().trim().min(1),
});

export const serverLogFilesQuerySchema = z.object({
  type: z.enum(["combined", "error"]).optional(),
});

export const serverLogFileParamsSchema = z.object({
  fileName: z
    .string()
    .trim()
    .regex(/^(combined|error)-\d{4}-\d{2}-\d{2}\.log(?:\.gz)?$/, "invalid log file name"),
});

export const serverLogContentQuerySchema = z.object({
  lines: z.coerce.number().int().min(1).max(2000).optional(),
  search: z.string().max(200).optional(),
});

export const consumptionStatsQuerySchema = z
  .object({
    startDate: z
      .string()
      .max(40)
      .refine((value) => validDateString(value), "startDate must be a valid date string")
      .optional(),
    endDate: z
      .string()
      .max(40)
      .refine((value) => validDateString(value), "endDate must be a valid date string")
      .optional(),
    userIds: z.preprocess(normalizeToArray, z.array(z.string().trim().min(1).max(100)).max(1000).optional()),
    models: z.preprocess(normalizeToArray, z.array(z.string().trim().min(1).max(200)).max(1000).optional()),
    channels: z.preprocess(normalizeToArray, z.array(z.string().trim().min(1).max(200)).max(1000).optional()),
    relayTokenIds: z.preprocess(normalizeToArray, z.array(z.string().trim().min(1).max(100)).max(1000).optional()),
  })
  .superRefine(validateDateRange);
