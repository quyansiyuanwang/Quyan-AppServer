import { z } from "zod";
import {
  TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_MAX,
  TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_MIN,
} from "@/constant/two-factor";

export const confirmTwoFactorSetupBodySchema = z.object({
  setupToken: z.string().trim().min(1).max(200),
  code: z.string().trim().min(6).max(6),
});

export const disableTwoFactorBodySchema = z
  .object({
    code: z.string().trim().min(6).max(6).optional(),
    recoveryCode: z.string().trim().min(6).max(100).optional(),
  })
  .refine((data) => Boolean(data.code) || Boolean(data.recoveryCode), {
    message: "code or recoveryCode is required",
    path: ["code"],
  })
  .refine((data) => !(data.code && data.recoveryCode), {
    message: "code and recoveryCode cannot be provided together",
    path: ["recoveryCode"],
  });

export const regenerateTwoFactorRecoveryCodesBodySchema = z
  .object({
    code: z.string().trim().min(6).max(6).optional(),
    recoveryCode: z.string().trim().min(6).max(100).optional(),
  })
  .refine((data) => Boolean(data.code) || Boolean(data.recoveryCode), {
    message: "code or recoveryCode is required",
    path: ["code"],
  })
  .refine((data) => !(data.code && data.recoveryCode), {
    message: "code and recoveryCode cannot be provided together",
    path: ["recoveryCode"],
  });

export const updateTwoFactorPasskeyPolicyBodySchema = z.object({
  passkeyRequired: z.boolean(),
});

export const twoFactorTrustedDeviceParamsSchema = z.object({
  deviceId: z
    .string()
    .trim()
    .length(64)
    .regex(/^[a-fA-F0-9]{64}$/),
});

export const twoFactorTrustedDevicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce
    .number()
    .int()
    .min(TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_MIN)
    .max(TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_MAX)
    .optional(),
});
