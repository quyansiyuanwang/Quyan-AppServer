import { z } from "zod";
import { ALL_NOTIFICATION_EVENTS, THRESHOLD_EVENTS } from "@/constant/notification-event";
import { FEEDBACK_PRIORITIES, FEEDBACK_TYPES } from "@/constant/feedback";

const validHostnameRegex = /^[a-zA-Z0-9.-]+$/;
const maxFourDecimalPlaces = (value: number) => Number.isInteger(value * 10000);

export const setConfigBodySchema = z.object({
  configs: z.record(z.string(), z.string()),
});

export const setBillingConfigBodySchema = z.object({
  rechargeRatio: z.coerce.number().positive().max(1000000).refine(maxFourDecimalPlaces, {
    message: "充值比例最多支持 4 位小数",
  }),
});

export const setHeartbeatConfigBodySchema = z.object({
  intervalSeconds: z.coerce.number().int().min(5).max(3600),
  timeoutSeconds: z.coerce.number().int().min(10).max(86400),
});

export const setRemoteTerminalUnbindConfigBodySchema = z.object({
  maxCount: z.coerce.number().int().min(0).max(1000),
  windowHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 365),
  rebindCooldownMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 365),
});

export const captchaProviderSchema = z.enum(["none", "recaptcha", "turnstile"]);

export const setCaptchaConfigBodySchema = z
  .object({
    provider: captchaProviderSchema,
    fallbackProvider: captchaProviderSchema,
    minScore: z.coerce.number().min(0).max(1),
    trustWindowMinutes: z.coerce.number().int().min(0).max(1440),
  })
  .refine((data) => data.provider !== "none" || data.fallbackProvider === "none", {
    message: "provider 为 none 时 fallbackProvider 必须为 none",
    path: ["fallbackProvider"],
  })
  .refine((data) => data.provider === "none" || data.fallbackProvider !== data.provider, {
    message: "备用提供方不能与主提供方相同",
    path: ["fallbackProvider"],
  });

export const setRegistrationConfigBodySchema = z.object({
  enabled: z.coerce.boolean(),
  maxAccountsPerEmail: z.coerce.number().int().min(1).max(100),
  defaultGroupUsername: z.string().min(2).max(30),
  verificationCodeExpiry: z.coerce.number().int().min(60).max(86400),
});

export const setRelayConfigBodySchema = z.object({
  upstreamUrl: z.string().max(500),
  upstreamApiKey: z.string().max(500),
  allowedModels: z.string().max(2000),
  customKeyEnabled: z.coerce.boolean(),
  customKeyMaxTokensPerUser: z.coerce.number().int().min(0).max(1000),
  customKeyCreateLimitWindowMinutes: z.coerce.number().int().min(1).max(525600),
  customKeyCreateLimitMaxCount: z.coerce.number().int().min(0).max(100000),
});

export const setSmtpConfigBodySchema = z.object({
  host: z.string().min(1).max(253).regex(validHostnameRegex),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.coerce.boolean(),
  user: z.string().max(200),
  password: z.string().max(200),
  senderName: z.string().max(100),
  senderEmail: z.string().email().max(200),
});

export const setNotificationConfigBodySchema = z.object({
  defaultSubscribedEvents: z
    .array(z.enum(ALL_NOTIFICATION_EVENTS as [string, ...string[]]))
    .max(ALL_NOTIFICATION_EVENTS.length),
  defaultThresholds: z.record(z.enum(THRESHOLD_EVENTS as unknown as [string, ...string[]]), z.coerce.number().min(0)),
  feedbackAssignmentRules: z.array(
    z
      .object({
        type: z.enum(FEEDBACK_TYPES).optional(),
        priority: z.enum(FEEDBACK_PRIORITIES).optional(),
        assigneeUserIds: z.array(z.string().trim().min(1)).min(1).max(50),
      })
      .refine((data) => !!data.type || !!data.priority, {
        message: "至少指定 type 或 priority 之一",
      }),
  ),
});

export const setIpBanConfigBodySchema = z.object({
  enabled: z.coerce.boolean(),
  level1Threshold: z.coerce.number().int().min(0),
  level1Duration: z.coerce.number().int().min(-1),
  level2Threshold: z.coerce.number().int().min(0),
  level2Duration: z.coerce.number().int().min(-1),
  level3Threshold: z.coerce.number().int().min(0),
  level3Duration: z.coerce.number().int().min(-1),
});
