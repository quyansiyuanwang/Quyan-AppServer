import { SUPPORT_ANALYTICS_POLICY } from "@/constant/support-analytics-policy";
import { z } from "zod";
const date = z
  .string()
  .max(40)
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Date must be valid",
    params: { messageKey: "validation.fieldInvalidFormat", messageParams: { field: "Date" } },
  });
export const supportAnalyticsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(SUPPORT_ANALYTICS_POLICY.maximumPageSize).optional(),
    startAt: date.optional(),
    endAt: date.optional(),
    userId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startAt && Date.parse(value.startAt) > (value.endAt ? Date.parse(value.endAt) : Date.now()))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endAt"],
        message: "endAt must not precede startAt",
        params: { messageKey: "validation.dateRangeOrder" },
      });
  });
