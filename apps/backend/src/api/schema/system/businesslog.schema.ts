import { z } from "zod";
import { OperationCategory, OperationType } from "@/constant/operation-type";

const BUSINESS_LOG_MAX_RANGE_DAYS = 30;
const BUSINESS_LOG_MAX_RANGE_MS = BUSINESS_LOG_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;

const validDateString = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
};

export const businessLogsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    operationType: z.nativeEnum(OperationType).optional(),
    operationCategory: z.nativeEnum(OperationCategory).optional(),
    actorUserId: z.string().max(200).optional(),
    actor: z.string().max(200).optional(),
    targetUserId: z.string().max(200).optional(),
    target: z.string().max(200).optional(),
    success: z.coerce.boolean().optional(),
    ip: z.string().max(45).optional(),
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
  })
  .superRefine((value, ctx) => {
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

    if (endDate - startDate <= BUSINESS_LOG_MAX_RANGE_MS) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: `date range cannot exceed ${BUSINESS_LOG_MAX_RANGE_DAYS} days`,
    });
  });

export const businessLogStatsQuerySchema = z
  .object({
    operationType: z.nativeEnum(OperationType).optional(),
    operationCategory: z.nativeEnum(OperationCategory).optional(),
    actorUserId: z.string().max(200).optional(),
    actor: z.string().max(200).optional(),
    targetUserId: z.string().max(200).optional(),
    target: z.string().max(200).optional(),
    success: z.coerce.boolean().optional(),
    ip: z.string().max(45).optional(),
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
  })
  .superRefine((value, ctx) => {
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

    if (endDate - startDate <= BUSINESS_LOG_MAX_RANGE_MS) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: `date range cannot exceed ${BUSINESS_LOG_MAX_RANGE_DAYS} days`,
    });
  });
