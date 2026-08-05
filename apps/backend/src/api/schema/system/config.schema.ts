import { z } from "zod";
import { ALL_NOTIFICATION_EVENTS, THRESHOLD_EVENTS } from "@/constant/notification-event";
import { TICKET_PRIORITIES, TICKET_TYPES } from "@/constant/ticket";

const validHostnameRegex = /^[a-zA-Z0-9.-]+$/;
const maxFourDecimalPlaces = (value: number) => Number.isInteger(value * 10000);

export const setConfigBodySchema = z.object({
  configs: z.record(z.string(), z.string()),
});

export const setBillingConfigBodySchema = z.object({
  rechargeRatio: z.coerce.number().positive().max(1000000).refine(maxFourDecimalPlaces, {
    message: "充值比例最多支持 4 位小数",
  }),
  giftCodeEnabled: z.coerce.boolean(),
  directTransferEnabled: z.coerce.boolean(),
  giftCodeFeePercent: z.coerce.number().min(0).max(100).refine(maxFourDecimalPlaces),
  directTransferFeePercent: z.coerce.number().min(0).max(100).refine(maxFourDecimalPlaces),
  giftCodeCancelFeeRefundPercent: z.coerce.number().min(0).max(100).refine(maxFourDecimalPlaces),
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

const callbackPathSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.startsWith("/") && !value.startsWith("//"), {
    message: "回调路径必须以单个 / 开头",
  });

const urlOrEmptySchema = z.string().max(500).url().or(z.literal(""));

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

const socialAuthGithubSchema = z.object({
  enabled: z.coerce.boolean(),
  clientId: z.string().max(200),
  clientSecret: z.string().max(500),
  authorizeUrl: urlOrEmptySchema,
  tokenUrl: urlOrEmptySchema,
  userUrl: urlOrEmptySchema,
  emailUrl: urlOrEmptySchema,
  scope: z.string().max(500),
  callbackPath: callbackPathSchema,
});

const socialAuthWechatSchema = z.object({
  enabled: z.coerce.boolean(),
  appId: z.string().max(200),
  appSecret: z.string().max(500),
  authorizeUrl: urlOrEmptySchema,
  tokenUrl: urlOrEmptySchema,
  userUrl: urlOrEmptySchema,
  scope: z.string().max(500),
  callbackPath: callbackPathSchema,
});

export const setSocialAuthConfigBodySchema = z
  .object({
    frontendBaseUrl: urlOrEmptySchema,
    qrLoginEnabled: z.coerce.boolean(),
    stateTtlSeconds: z.coerce.number().int().min(60).max(3600),
    qrLoginTtlSeconds: z.coerce.number().int().min(60).max(1800),
    qrLoginPollIntervalSeconds: z.coerce.number().int().min(1).max(30),
    github: socialAuthGithubSchema,
    wechatOpen: socialAuthWechatSchema,
    wechatWeb: socialAuthWechatSchema,
  })
  .superRefine((data, ctx) => {
    const requireWhenEnabled = (enabled: boolean, value: string, path: (string | number)[], message: string) => {
      if (enabled && !value.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    };

    requireWhenEnabled(
      data.github.enabled,
      data.github.clientId,
      ["github", "clientId"],
      "启用 GitHub 时必须填写 clientId",
    );
    requireWhenEnabled(
      data.github.enabled,
      data.github.clientSecret,
      ["github", "clientSecret"],
      "启用 GitHub 时必须填写 clientSecret",
    );
    requireWhenEnabled(
      data.github.enabled,
      data.github.authorizeUrl,
      ["github", "authorizeUrl"],
      "启用 GitHub 时必须填写授权地址",
    );
    requireWhenEnabled(
      data.github.enabled,
      data.github.tokenUrl,
      ["github", "tokenUrl"],
      "启用 GitHub 时必须填写令牌地址",
    );
    requireWhenEnabled(
      data.github.enabled,
      data.github.userUrl,
      ["github", "userUrl"],
      "启用 GitHub 时必须填写用户信息地址",
    );
    requireWhenEnabled(
      data.github.enabled,
      data.github.emailUrl,
      ["github", "emailUrl"],
      "启用 GitHub 时必须填写邮箱地址接口",
    );
    requireWhenEnabled(data.github.enabled, data.github.scope, ["github", "scope"], "启用 GitHub 时必须填写 scope");

    requireWhenEnabled(
      data.wechatOpen.enabled,
      data.wechatOpen.appId,
      ["wechatOpen", "appId"],
      "启用微信开放平台时必须填写 appId",
    );
    requireWhenEnabled(
      data.wechatOpen.enabled,
      data.wechatOpen.appSecret,
      ["wechatOpen", "appSecret"],
      "启用微信开放平台时必须填写 appSecret",
    );
    requireWhenEnabled(
      data.wechatOpen.enabled,
      data.wechatOpen.authorizeUrl,
      ["wechatOpen", "authorizeUrl"],
      "启用微信开放平台时必须填写授权地址",
    );
    requireWhenEnabled(
      data.wechatOpen.enabled,
      data.wechatOpen.tokenUrl,
      ["wechatOpen", "tokenUrl"],
      "启用微信开放平台时必须填写令牌地址",
    );
    requireWhenEnabled(
      data.wechatOpen.enabled,
      data.wechatOpen.userUrl,
      ["wechatOpen", "userUrl"],
      "启用微信开放平台时必须填写用户信息地址",
    );
    requireWhenEnabled(
      data.wechatOpen.enabled,
      data.wechatOpen.scope,
      ["wechatOpen", "scope"],
      "启用微信开放平台时必须填写 scope",
    );

    requireWhenEnabled(
      data.wechatWeb.enabled,
      data.wechatWeb.appId,
      ["wechatWeb", "appId"],
      "启用微信网页时必须填写 appId",
    );
    requireWhenEnabled(
      data.wechatWeb.enabled,
      data.wechatWeb.appSecret,
      ["wechatWeb", "appSecret"],
      "启用微信网页时必须填写 appSecret",
    );
    requireWhenEnabled(
      data.wechatWeb.enabled,
      data.wechatWeb.authorizeUrl,
      ["wechatWeb", "authorizeUrl"],
      "启用微信网页时必须填写授权地址",
    );
    requireWhenEnabled(
      data.wechatWeb.enabled,
      data.wechatWeb.tokenUrl,
      ["wechatWeb", "tokenUrl"],
      "启用微信网页时必须填写令牌地址",
    );
    requireWhenEnabled(
      data.wechatWeb.enabled,
      data.wechatWeb.userUrl,
      ["wechatWeb", "userUrl"],
      "启用微信网页时必须填写用户信息地址",
    );
    requireWhenEnabled(
      data.wechatWeb.enabled,
      data.wechatWeb.scope,
      ["wechatWeb", "scope"],
      "启用微信网页时必须填写 scope",
    );
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

export const setSiteConfigBodySchema = z.object({
  backendPublicUrl: z.string().max(500).url().or(z.literal("")),
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
  ticketAssignmentRules: z.array(
    z
      .object({
        type: z.enum(TICKET_TYPES).optional(),
        priority: z.enum(TICKET_PRIORITIES).optional(),
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
