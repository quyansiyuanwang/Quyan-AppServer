import { z } from "zod";

const slug = /^[a-z0-9-]+$/;
const alias = /^[A-Z][A-Z0-9_]{0,99}$/;
const key = /^[A-Za-z0-9._:-]{1,191}$/;
const scopes = ["kv:read", "kv:write", "verification:send", "verification:verify", "ip:lookup", "push:send"] as const;

export const projectIdParamsSchema = z.object({ projectId: z.string().trim().min(1) });
export const idParamsSchema = z.object({ id: z.string().trim().min(1) });
export const kvKeyParamsSchema = z.object({ key: z.string().trim().regex(key) });
export const shortCodeParamsSchema = z.object({ code: z.string().trim().min(3).max(80).regex(slug) });
export const createProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(3).max(80).regex(slug),
  description: z.string().trim().max(500).optional(),
});
export const createProjectApiKeyBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(scopes)).min(1).max(scopes.length),
  expiresAt: z.string().datetime().optional(),
});
export const setKvValueBodySchema = z.object({
  value: z.unknown(),
  ttlSeconds: z.number().int().min(1).max(2_592_000).optional(),
});
export const createShortLinkBodySchema = z.object({
  targetUrl: z.string().url().max(2_000),
  code: z.string().trim().min(3).max(80).regex(slug).optional(),
  expiresAt: z.string().datetime().optional(),
});
export const updateShortLinkBodySchema = z.object({
  targetUrl: z.string().url().max(2_000).optional(),
  enabled: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export const upsertSecretBodySchema = z.object({
  alias: z.string().trim().regex(alias),
  value: z.string().min(1).max(20_000),
});
export const createStatusMonitorBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  targetUrl: z.string().url().max(2_000),
  method: z.enum(["GET", "HEAD"]).optional(),
  intervalSec: z.number().int().min(60).max(86_400).optional(),
  successStatusCodes: z.array(z.number().int().min(100).max(599)).min(1).max(100).optional(),
});
export const updateStatusMonitorBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  targetUrl: z.string().url().max(2_000).optional(),
  method: z.enum(["GET", "HEAD"]).optional(),
  intervalSec: z.number().int().min(60).max(86_400).optional(),
  successStatusCodes: z.array(z.number().int().min(100).max(599)).min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});
export const sendVerificationBodySchema = z.object({
  channel: z.enum(["email", "sms"]),
  recipient: z.string().trim().min(3).max(320),
  purpose: z.string().trim().min(1).max(100),
});
export const verifyCodeBodySchema = sendVerificationBodySchema.extend({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});
export const createPushChannelBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(["webhook", "dingtalk", "feishu", "wechat_work"]),
  endpoint: z.string().url().max(2_000),
  secretAlias: z.string().trim().regex(alias).optional(),
});
export const updatePushChannelBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  endpoint: z.string().url().max(2_000).optional(),
  secretAlias: z.string().trim().regex(alias).nullable().optional(),
  enabled: z.boolean().optional(),
});
export const sendPushBodySchema = z.object({
  channelIds: z.array(z.string().trim().min(1)).min(1).max(20),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(10_000),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});

export const quotaOverrideIdParamsSchema = z.object({ id: z.string().trim().min(1) });
export const upsertQuotaOverrideBodySchema = z.object({
  subjectType: z.enum(["user", "project"]),
  subjectId: z.string().trim().min(1).max(191),
  service: z.enum(["verification", "ip", "push"]).optional(),
  dailyFreeQuota: z.number().int().min(0).max(10_000_000),
  expiresAt: z.string().datetime().nullable().optional(),
});
