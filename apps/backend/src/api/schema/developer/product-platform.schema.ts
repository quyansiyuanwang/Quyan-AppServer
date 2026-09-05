import { DEVELOPER_PRODUCT_CODES } from "@quyan/shared";
import { z } from "zod";

const productCode = z.enum(DEVELOPER_PRODUCT_CODES);
const slug = /^[a-z0-9-]+$/;

export const productCodeParamsSchema = z.object({ product: productCode });
export const productInstanceParamsSchema = z.object({ product: productCode, instanceId: z.string().trim().min(1) });
export const productResourceInstanceParamsSchema = z.object({ instanceId: z.string().trim().min(1) });
export const productResourceKvParamsSchema = productResourceInstanceParamsSchema.extend({
  key: z.string().trim().min(1).max(191),
});
export const productResourceIdParamsSchema = productResourceInstanceParamsSchema.extend({
  id: z.string().trim().min(1),
});
export const productResourceAliasParamsSchema = productResourceInstanceParamsSchema.extend({
  alias: z.string().trim().min(1).max(100),
});
export const productPushSecretInstanceParamsSchema = productResourceInstanceParamsSchema.extend({
  secretInstanceId: z.string().trim().min(1),
});
export const productAccountParamsSchema = z.object({
  product: productCode,
  accountId: z.string().trim().min(1),
});
export const productUserParamsSchema = z.object({
  product: productCode,
  userId: z.string().trim().min(1),
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

export const createProductInstanceBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(3).max(80).regex(slug),
});

export const updateProductInstanceBodySchema = z.object({
  enabled: z.boolean(),
});

export const managedProductAccountsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  keyword: z.string().trim().max(200).optional(),
});

export const updateProductAccountBodySchema = z.object({
  dailyFreeQuota: z.number().int().min(0).max(10_000_000).nullable(),
  overageEnabled: z.boolean(),
  instanceLimit: z.number().int().min(1).max(1_000),
});

export const createProductKeyBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  subjectUserId: z.string().trim().min(1).max(191),
  actions: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  expiresAt: z.string().datetime().optional(),
});

export const shortLinkStatsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
