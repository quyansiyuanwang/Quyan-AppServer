import { z } from "zod";

const optionalDate = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date")
  .optional();

export const aiRequestLogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  user: z.string().trim().max(191).optional(),
  relayToken: z.string().trim().max(191).optional(),
  model: z.string().trim().max(160).optional(),
  requestFormat: z.string().trim().max(40).optional(),
  statusCode: z.coerce.number().int().min(100).max(599).optional(),
  requestId: z.string().trim().max(64).optional(),
  keyword: z.string().trim().max(500).optional(),
  truncated: z
    .preprocess((value) => (value === "true" ? true : value === "false" ? false : value), z.boolean())
    .optional(),
  startDate: optionalDate,
  endDate: optionalDate,
});

export const aiRequestLogParamsSchema = z.object({
  id: z.string().trim().min(1).max(191),
});
