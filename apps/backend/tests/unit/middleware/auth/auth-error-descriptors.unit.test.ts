/**
 * P07 — 认证域错误描述符（安全边界）
 *
 * 锁定三件事：
 * 1. **具体原因不被合并**：登录态失效有 4 种互不相同的业务原因（旧 Token、被强制下线、
 *    会话被强制结束、用户信息变更），必须各自保留一句话，不能退化成同一条通用提示。
 * 2. **本地化**：同一 key 在中英文下都可渲染，且无残留占位符。
 * 3. **不泄露内部诊断**：底层校验器原文（JWT/签名/会话）只进日志，不出现在用户消息里。
 */
import { describe, expect, it } from "vitest";
import { SUPPORTED_BACKEND_LOCALES, translateMessage, type MessageKey } from "@/locales";

/** 登录态失效的 4 种具体原因——必须互不相同 */
const SESSION_REASONS: MessageKey[] = [
  "auth.oldTokenVersion",
  "auth.forcedOffline",
  "auth.sessionForcedEnded",
  "errors.tokenExpiredDueToUpdate",
];

/** 防重放的 5 种具体原因 */
const REPLAY_REASONS: MessageKey[] = [
  "auth.invalidTimestamp",
  "auth.requestExpired",
  "auth.signingSessionInvalid",
  "auth.signingSessionExpired",
  "auth.signatureInvalid",
];

/** 认证边界其余关键原因 */
const BOUNDARY_REASONS: MessageKey[] = [
  "auth.missingToken",
  "errors.invalidToken",
  "auth.tokenVerificationFailed",
  "auth.reurlExpired",
  "auth.roleSessionMismatch",
  "ram.roleSessionNotFound",
  "auth.missingRelayToken",
  "auth.missingProductApiKey",
  "auth.legacyDeveloperProjectDisabled",
  "auth.legacyDeveloperApiDisabled",
  "auth.oauthTokenNotAllowed",
  "auth.oauthTokenInvalid",
  "auth.oauthTokenRevoked",
  "auth.oauthTokenExpired",
  "errors.accountDisabled",
  "errors.accountDeleted",
  "errors.accountStatusAbnormal",
  "errors.captchaTrustRequired",
  "auth.missingCaptchaToken",
  "errors.requireReplayProtection",
  "auth.requestAlreadyUsed",
  "auth.signingSessionMismatch",
];

describe("P07 · 认证域具体原因不被合并", () => {
  it.each([...SUPPORTED_BACKEND_LOCALES])("keeps the 4 session-expiry reasons distinct in %s", (locale) => {
    const messages = SESSION_REASONS.map((key) => translateMessage(key, locale));

    expect(new Set(messages).size).toBe(SESSION_REASONS.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(0);
  });

  it.each([...SUPPORTED_BACKEND_LOCALES])("keeps the 5 replay reasons distinct in %s", (locale) => {
    const messages = REPLAY_REASONS.map((key) => translateMessage(key, locale));

    expect(new Set(messages).size).toBe(REPLAY_REASONS.length);
  });
});

describe("P07 · 认证域描述符渲染", () => {
  it.each([...SUPPORTED_BACKEND_LOCALES])("renders every auth-boundary reason cleanly in %s", (locale) => {
    const failures: string[] = [];

    for (const key of [...BOUNDARY_REASONS, ...SESSION_REASONS, ...REPLAY_REASONS]) {
      const message = translateMessage(key, locale);
      if (message === key) failures.push(`${key}: fell back to the key`);
      if (message.includes("{{") || message.includes("}}")) failures.push(`${key}: residual placeholder`);
      if (message.trim().length === 0) failures.push(`${key}: empty`);
    }

    expect(failures).toEqual([]);
  });

  it("localizes the OAuth scope reason with a safe scalar parameter", () => {
    expect(translateMessage("auth.insufficientOAuthScope", "en", { scopes: "user:read" })).toBe(
      "Insufficient OAuth scope: user:read",
    );
    expect(translateMessage("auth.insufficientOAuthScope", "zh-CN", { scopes: "user:read" })).toBe(
      "OAuth 授权范围不足：user:read",
    );
  });
});

describe("P07 · 内部诊断不外发", () => {
  it("keeps the verification-failure message free of internal details", () => {
    for (const locale of SUPPORTED_BACKEND_LOCALES) {
      const message = translateMessage("auth.tokenVerificationFailed", locale);

      for (const leak of ["jwt", "JWT", "malformed", "signature", "TokenExpiredError", "secret"]) {
        expect(message).not.toContain(leak);
      }
    }
  });
});
