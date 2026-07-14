import { z } from "zod";
import { ALL_NOTIFICATION_EVENTS } from "@/constant/notification-event";

const WEBHOOK_FORMATS = ["generic", "discord", "slack", "feishu", "wechat_work"] as const;

export const updateNotificationPreferenceBodySchema = z.object({
  notificationEmail: z.string().email().max(200).nullable().optional(),
  subscribedEvents: z
    .array(z.enum(ALL_NOTIFICATION_EVENTS as [string, ...string[]]))
    .max(ALL_NOTIFICATION_EVENTS.length)
    .optional(),
  thresholds: z.record(z.string(), z.number().min(0).max(100000)).optional(),
  cooldownMinutes: z.number().int().min(0).max(43200).optional(), // max 30 days
});

export const createNotificationWebhookBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().url().max(2048),
  format: z.enum(WEBHOOK_FORMATS),
  secret: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const updateNotificationWebhookBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  url: z.string().url().max(2048).optional(),
  format: z.enum(WEBHOOK_FORMATS).optional(),
  secret: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const webhookIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const notificationLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const notificationInboxQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  unreadOnly: z.coerce.boolean().optional().default(false),
});

export const markNotificationInboxReadBodySchema = z
  .object({
    ids: z.array(z.string().trim().min(1)).max(200).optional(),
    markAll: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.markAll) || (Array.isArray(value.ids) && value.ids.length > 0), {
    message: "ids 或 markAll 至少提供一个",
  });
