import { z } from "zod";

const usernameRegex = /^[a-zA-Z0-9_]+$/;
const siteRelativeRedirectRegex = /^\/(?!\/).*/;
const externalAuthProviders = ["github", "wechat-open", "wechat-web"] as const;
const externalAuthActions = ["login", "bind"] as const;

const externalRedirectSchema = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (value) => {
      if (!value) return false;
      if (siteRelativeRedirectRegex.test(value)) return true;
      return z.string().url().safeParse(value).success;
    },
    {
      message: "Invalid redirect url",
    },
  );

export const loginBodySchema = z.object({
  username: z.string().trim().min(3).max(20).regex(usernameRegex),
  password: z.string().min(6).max(50),
  agreedToLegalPolicies: z.literal(true),
  captchaToken: z.string().max(4000).optional(),
});

export const refreshBodySchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    refresh_token: z.string().min(10).optional(),
  }),
);

export const logoutBodySchema = z.object({
  access_token: z.string().min(10).optional(),
  refresh_token: z.string().min(10).optional(),
});

export const verifyBodySchema = z.object({
  access_token: z.string().min(10),
});

export const sendRegisterVerificationCodeBodySchema = z.object({
  email: z.string().email().max(200),
  captchaToken: z.string().max(4000).optional(),
});

export const sendPasswordResetCodeBodySchema = z.object({
  username: z.string().trim().min(3).max(20).regex(usernameRegex),
  email: z.string().email().max(200),
  captchaToken: z.string().max(4000).optional(),
});

export const registerBodySchema = z.object({
  username: z.string().trim().min(3).max(20).regex(usernameRegex),
  password: z.string().min(6).max(50),
  nickname: z.string().max(50).optional(),
  email: z.string().email().max(200),
  verificationCode: z.string().min(6).max(6),
  agreedToLegalPolicies: z.literal(true),
  captchaToken: z.string().max(4000).optional(),
});

export const acceptPolicyConsentBodySchema = z.object({
  challengeToken: z.string().trim().min(1).max(200),
  agreedToLegalPolicies: z.literal(true),
});

export const resetPasswordBodySchema = z.object({
  username: z.string().trim().min(3).max(20).regex(usernameRegex),
  email: z.string().email().max(200),
  verificationCode: z.string().trim().min(6).max(6),
  newPassword: z.string().min(6).max(50),
  captchaToken: z.string().max(4000).optional(),
});

export const verifyTwoFactorLoginBodySchema = z
  .object({
    challengeToken: z.string().trim().min(1).max(200),
    code: z.string().trim().min(6).max(6).optional(),
    recoveryCode: z.string().trim().min(6).max(100).optional(),
    emailCode: z.string().trim().min(6).max(6).optional(),
  })
  .refine((data) => Boolean(data.code) || Boolean(data.recoveryCode) || Boolean(data.emailCode), {
    message: "code, recoveryCode or emailCode is required",
    path: ["code"],
  })
  .refine(
    (data) => [Boolean(data.code), Boolean(data.recoveryCode), Boolean(data.emailCode)].filter(Boolean).length <= 1,
    {
      message: "only one of code, recoveryCode or emailCode can be provided",
      path: ["recoveryCode"],
    },
  );

export const sendTwoFactorEmailCodeBodySchema = z.object({
  challengeToken: z.string().trim().min(1).max(200),
  captchaToken: z.string().max(4000).optional(),
});

export const verifyCaptchaTrustBodySchema = z.object({
  captchaToken: z.string().trim().min(1).max(4000),
  action: z.string().trim().min(1).max(100),
  provider: z.enum(["recaptcha", "turnstile"]),
});

export const startExternalAuthBodySchema = z.object({
  provider: z.enum(externalAuthProviders),
  action: z.enum(externalAuthActions).optional(),
  redirectUri: externalRedirectSchema.optional(),
});

export const externalAuthCallbackQuerySchema = z.object({
  code: z.string().trim().min(1).max(2000),
  state: z.string().trim().min(1).max(500),
});

export const qrLoginStatusQuerySchema = z.object({
  sessionId: z.string().trim().min(1).max(200),
});

export const bindExternalIdentityBodySchema = z.object({
  provider: z.enum(externalAuthProviders),
  bindingToken: z.string().trim().min(1).max(500),
});

export const unbindExternalIdentityBodySchema = z.object({
  provider: z.enum(externalAuthProviders),
});

export const scanQrLoginBodySchema = z.object({
  sessionId: z.string().trim().min(1).max(200),
});

export const confirmQrLoginBodySchema = z.object({
  sessionId: z.string().trim().min(1).max(200),
  approve: z.boolean(),
});
