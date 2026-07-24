import { DEVELOPER_PRODUCT_CODES } from "@appserver/shared";
import { z } from "zod";

const productCode = z.enum(DEVELOPER_PRODUCT_CODES);
const slug = /^[a-z0-9-]+$/;

export const productCodeParamsSchema = z.object({ product: productCode });
export const productInstanceParamsSchema = z.object({ product: productCode, instanceId: z.string().trim().min(1) });
export const productResourceInstanceParamsSchema = z.object({ instanceId: z.string().trim().min(1) });
export const productEntitlementParamsSchema = z.object({
  product: productCode,
  entitlementId: z.string().trim().min(1),
});
export const productKeyParamsSchema = z.object({
  product: productCode,
  instanceId: z.string().trim().min(1),
  keyId: z.string().trim().min(1),
});

export const updateProductConfigBodySchema = z.object({
  enabled: z.boolean(),
  defaultDailyQuota: z.number().int().min(0).max(10_000_000),
  overagePrice: z.number().min(0).max(1_000_000),
  defaultInstanceLimit: z.number().int().min(1).max(1_000),
  retentionDays: z.number().int().min(1).max(3_650),
  resourceLimits: z.record(z.string(), z.unknown()).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const upsertProductEntitlementBodySchema = z.object({
  accountOwnerId: z.string().trim().min(1).max(191),
  enabled: z.boolean().optional(),
  dailyFreeQuota: z.number().int().min(0).max(10_000_000).nullable().optional(),
  overageEnabled: z.boolean().optional(),
  instanceLimit: z.number().int().min(1).max(1_000).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const createProductInstanceBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(3).max(80).regex(slug),
});

export const createProductKeyBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  subjectUserId: z.string().trim().min(1).max(191),
  actions: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  expiresAt: z.string().datetime().optional(),
});
