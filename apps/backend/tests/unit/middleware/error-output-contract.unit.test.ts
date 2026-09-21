/**
 * P02 — 现有行为回归基线（错误/i18n 重构前置锁定）
 *
 * 本文件的目的不是描述「期望的正确设计」，而是把重构前**可观测的实际行为**固定下来，
 * 使 P03–P13 的每一步改动都能立刻看出是否破坏了既有契约。
 *
 * 其中若干断言刻意记录了计划中已确认、但**尚未修复**的问题（F01/F04/安全边界）。
 * 这些断言在对应任务实施时必须被**有意地**翻转，并同步更新本文件与计划文档：
 *
 * - `raw messages are localized only via the legacy reverse catalog` → F01，P13 拆除
 * - `Zod issue messages pass through verbatim`    → F04，P06 修复
 * - `TSOA field messages pass through verbatim`   → F04，P06 修复
 * - `unknown errors surface the raw message outside production` → 安全边界，P05 收口
 * - `JWT errors include the original error message`            → 安全边界，P05 收口
 *
 * 已在 P05 **有意翻转**的项（F03）：
 * - `direct 4xx responses are not localized and not re-wrapped`
 *   → 现为 `localizes an explicit non-2xx envelope without re-wrapping it`：
 *     非 2xx 只统一 `message`，信封形状与 `fields`/`error`/`data` 等附加字段保持不变。
 *
 * 未在本文件覆盖的项（P12/P15 处理）：前端错误链路、真实 repair.html 静态访问、真实 DB 的认证恢复。
 */
import express, { type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ValidateError } from "@tsoa/runtime";
import { Prisma } from "@prisma/client";
import { HttpStatusCode } from "axios";
import { z } from "zod";
import { localeMiddleware } from "@/middleware/locale";
import { responseWrapperMiddleware } from "@/middleware/response-wrapper";
import { exceptionMiddleware } from "@/middleware/exception";
import { validateBody } from "@/middleware/validation/zod-validator.middleware";
import { CustomCode } from "@/constant/custom-code";
import {
  BadRequestError,
  PolicyConsentRequiredError,
  TooManyRequestsError,
  TwoFactorRequiredError,
  UnauthorizedError,
  ValidationError,
} from "@/util/errors";
import { setResponseMessage, setResponseMessageKey } from "@/util/response-wrapper";
import { ErrorReportService } from "@/services/system/error-report.service";
import { translateMessage } from "@/locales";

const GET = (app: express.Express, path: string, locale?: string) => {
  const req = request(app).get(path);
  return locale === undefined ? req : req.set("X-Locale", locale);
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(localeMiddleware);
  app.use(responseWrapperMiddleware);

  app.get("/success", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // 成功消息 · 描述符路径（P05 目标形态）
  app.get("/success-descriptor", (req: Request, res: Response) => {
    setResponseMessageKey(req as never, "group.deleted");
    res.json({ ok: true });
  });

  // 成功消息 · 原文反查路径（F01 遗留，P13 拆除）
  app.get("/success-raw-message", (req: Request, res: Response) => {
    setResponseMessage(req as never, "登出成功");
    res.json({ ok: true });
  });

  // 2xx 且响应体自带 code：走 translateKnownMessage 后原样返回
  app.get("/pre-wrapped-2xx", (_req: Request, res: Response) => {
    res.json({ code: CustomCode.OK, message: "登出成功" });
  });

  // 非 2xx 直接响应：包装器只统一 message，不重新包装、不改动附加字段（F03 已在 P05 修复）
  app.get("/direct-404", (_req: Request, res: Response) => {
    res.status(HttpStatusCode.NotFound).json({ code: CustomCode.NOT_FOUND, message: "用户组不存在" });
  });

  app.get("/direct-422-with-extras", (_req: Request, res: Response) => {
    res.status(HttpStatusCode.UnprocessableEntity).json({
      code: CustomCode.VALIDATION_FAILED,
      message: "用户组不存在",
      fields: { "body.email": ["Invalid email"] },
      requestId: "rid-1",
    });
  });

  // 描述符错误 + 认证挑战 data
  app.get("/two-factor", () => {
    throw new TwoFactorRequiredError(undefined, {
      challengeToken: "challenge-abc",
      expiresIn: 300,
      method: "passkey",
      purpose: "stepup",
      redirect: "/system/security",
    });
  });

  app.get("/policy-consent", () => {
    throw new PolicyConsentRequiredError(undefined, {
      requiresPolicyConsent: true,
      challengeToken: "consent-xyz",
      expiresIn: 600,
    });
  });

  // 400 + 限流 Retry-After
  app.get("/too-many-requests", () => {
    throw new TooManyRequestsError(undefined, 30);
  });

  // 401 无 messageKey：依赖原文反查
  app.get("/unauthorized-raw", () => {
    throw new UnauthorizedError("未授权访问");
  });

  // 已登记的中文原文（在 legacy 目录内）
  app.get("/raw-cjk-catalogued", () => {
    throw new BadRequestError("用户组不存在");
  });

  // 未登记的中文原文（不在 legacy 目录内）
  app.get("/raw-cjk-uncatalogued", () => {
    throw new BadRequestError("这是未登记的原文提示");
  });

  // 未登记的英文原文（zh-CN 下原样返回英文）
  app.get("/raw-en-uncatalogued", () => {
    throw new BadRequestError("Channel does not have OpenAI upstream configured");
  });

  // 字段级 ValidationError（已有 fields 承载结构）
  app.get("/validation-fields", () => {
    throw new ValidationError("Validation failed", {
      "body.email": ["邮箱格式不正确"],
      "body.password": ["密码长度必须为 6 到 50 个字符"],
    });
  });

  // TSOA 校验错误：字段消息原样透传（F04）
  app.get("/tsoa-validate", () => {
    throw new ValidateError(
      {
        password: {
          message: "password must be at least 8 characters, but the value was 'p@ss123'",
          value: "p@ss123",
        },
      },
      "Validation failed",
    );
  });

  app.post("/zod-validate", validateBody(z.object({ name: z.string(), flag: z.boolean() })), (_req, res) => {
    res.json({ ok: true });
  });

  // Prisma 唯一约束
  app.get("/prisma-unique", () => {
    throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`username`)", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["username"] },
    });
  });

  app.get("/jwt-expired", () => {
    const error = new Error("jwt expired");
    error.name = "TokenExpiredError";
    throw error;
  });

  app.get("/jwt-invalid", () => {
    const error = new Error("invalid signature");
    error.name = "JsonWebTokenError";
    throw error;
  });

  app.get("/unknown-error", () => {
    throw new Error("boom-internal-detail");
  });

  app.use((_req: Request, res: Response) => {
    res.status(HttpStatusCode.NotFound).json({ code: CustomCode.NOT_FOUND, message: "Not Found" });
  });

  app.use(exceptionMiddleware);

  return app;
}

describe("P02 baseline · locale resolution and request isolation", () => {
  it("defaults to en when X-Locale is absent, empty or unknown", async () => {
    const app = createApp();

    for (const locale of [undefined, "", "emoji", "fr", "zh"]) {
      const response = await GET(app, "/success", locale).expect(200);
      expect(response.headers["x-locale"]).toBe("en");
      expect(response.body.message).toBe("Success");
    }
  });

  it("normalizes zh-CN variants and en variants", async () => {
    const app = createApp();

    for (const locale of ["zh-CN", "zh-cn", "ZH-CN"]) {
      const response = await GET(app, "/success", locale).expect(200);
      expect(response.headers["x-locale"]).toBe("zh-CN");
      expect(response.body.message).toBe("操作成功");
    }

    for (const locale of ["en", "en-US", "en-GB"]) {
      const response = await GET(app, "/success", locale).expect(200);
      expect(response.headers["x-locale"]).toBe("en");
      expect(response.body.message).toBe("Success");
    }
  });

  it("keeps concurrent requests in separate locales", async () => {
    const app = createApp();
    const locales = ["zh-CN", "en", "zh-CN", "en", "zh-CN", "en", "zh-CN", "en"];

    const responses = await Promise.all(locales.map((locale) => GET(app, "/raw-cjk-catalogued", locale).expect(400)));

    responses.forEach((response, index) => {
      expect(response.headers["x-locale"]).toBe(locales[index]);
      expect(response.body.message).toBe(locales[index] === "en" ? "User group does not exist" : "用户组不存在");
    });
  });
});

describe("P02 baseline · success response wrapping", () => {
  it("wraps a plain 2xx body with code 0 and the default success message", async () => {
    const app = createApp();

    await GET(app, "/success", "en")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ code: CustomCode.OK, message: "Success", data: { ok: true } });
      });

    await GET(app, "/success", "zh-CN")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ code: CustomCode.OK, message: "操作成功", data: { ok: true } });
      });
  });

  it("renders a success message descriptor (P05 target path)", async () => {
    const app = createApp();

    await GET(app, "/success-descriptor", "en")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: CustomCode.OK, message: "Deleted successfully", data: { ok: true } });
      });

    await GET(app, "/success-descriptor", "zh-CN")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: CustomCode.OK, message: "删除成功", data: { ok: true } });
      });
  });

  it("still renders success messages through the legacy reverse catalog", async () => {
    const app = createApp();

    await GET(app, "/success-raw-message", "en")
      .expect(200)
      .expect(({ body }) => {
        expect(body.message).toBe("Logged out successfully");
      });

    await GET(app, "/success-raw-message", "zh-CN")
      .expect(200)
      .expect(({ body }) => {
        expect(body.message).toBe("登出成功");
      });
  });

  it("localizes an already wrapped 2xx body by raw message lookup", async () => {
    const app = createApp();

    await GET(app, "/pre-wrapped-2xx", "en")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ code: CustomCode.OK, message: "Logged out successfully" });
      });

    await GET(app, "/pre-wrapped-2xx", "zh-CN")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ code: CustomCode.OK, message: "登出成功" });
      });
  });
});

describe("P02 baseline · non-2xx responses", () => {
  // 本节断言在 P05 被**有意翻转**：旧实现让包装器完全跳过非 2xx，导致
  // 「显式业务失败」与「抛异常」文案不一致（F03）。P05 后非 2xx 只统一 `message`，
  // 信封形状与附加字段仍保持原样、不重新包装。
  it("localizes an explicit non-2xx envelope without re-wrapping it", async () => {
    const app = createApp();

    await GET(app, "/direct-404", "en")
      .expect(404)
      .expect(({ body }) => {
        expect(body).toEqual({ code: CustomCode.NOT_FOUND, message: "User group does not exist" });
      });

    await GET(app, "/direct-404", "zh-CN")
      .expect(404)
      .expect(({ body }) => {
        expect(body).toEqual({ code: CustomCode.NOT_FOUND, message: "用户组不存在" });
      });
  });

  it("keeps extra non-2xx fields (fields / error / data) untouched", async () => {
    const app = createApp();

    await GET(app, "/direct-422-with-extras", "en")
      .expect(422)
      .expect(({ body }) => {
        expect(body).toEqual({
          code: CustomCode.VALIDATION_FAILED,
          message: "User group does not exist",
          fields: { "body.email": ["Invalid email"] },
          requestId: "rid-1",
        });
      });
  });

  it("the application 404 handler output is identical in both locales", async () => {
    const app = createApp();

    await GET(app, "/missing-path", "en")
      .expect(404)
      .expect(({ body }) => {
        expect(body).toEqual({ code: CustomCode.NOT_FOUND, message: "Not Found" });
      });

    await GET(app, "/missing-path", "zh-CN")
      .expect(404)
      .expect(({ body }) => {
        expect(body).toEqual({ code: CustomCode.NOT_FOUND, message: "Not Found" });
      });
  });
});

describe("P02 baseline · ApiError output contract", () => {
  it("preserves two-factor challenge data and custom code", async () => {
    const app = createApp();

    for (const locale of ["en", "zh-CN"]) {
      const response = await GET(app, "/two-factor", locale).expect(HttpStatusCode.Unauthorized);

      expect(response.body).toEqual({
        code: CustomCode.TWO_FACTOR_REQUIRED,
        message: translateMessage("errors.twoFactorRequired", locale === "en" ? "en" : "zh-CN"),
        data: {
          challengeToken: "challenge-abc",
          expiresIn: 300,
          method: "passkey",
          purpose: "stepup",
          redirect: "/system/security",
        },
      });
    }
  });

  it("preserves policy consent challenge data and custom code", async () => {
    const app = createApp();

    const response = await GET(app, "/policy-consent", "zh-CN").expect(HttpStatusCode.Unauthorized);

    expect(response.body).toEqual({
      code: CustomCode.POLICY_CONSENT_REQUIRED,
      message: "需要同意最新服务协议和隐私政策",
      data: { requiresPolicyConsent: true, challengeToken: "consent-xyz", expiresIn: 600 },
    });
  });

  it("keeps Retry-After header and retryAfter payload for rate limiting", async () => {
    const app = createApp();

    const response = await GET(app, "/too-many-requests", "en").expect(429);

    expect(response.headers["retry-after"]).toBe("30");
    expect(response.body).toEqual({
      code: CustomCode.TOO_MANY_REQUESTS,
      message: "Too many requests",
      data: { retryAfter: 30 },
    });
  });

  it("localizes only through the reverse catalog while the legacy path exists", async () => {
    const app = createApp();

    // 目录内原文：可被反向翻译
    await GET(app, "/raw-cjk-catalogued", "en")
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe("User group does not exist");
      });

    await GET(app, "/raw-cjk-catalogued", "zh-CN")
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe("用户组不存在");
      });

    // 目录外中文原文：两种语言都原样返回
    await GET(app, "/raw-cjk-uncatalogued", "en")
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe("这是未登记的原文提示");
      });

    await GET(app, "/raw-cjk-uncatalogued", "zh-CN")
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe("这是未登记的原文提示");
      });
  });

  it("returns unlocalized english for uncatalogued raw messages under zh-CN", async () => {
    const app = createApp();
    const raw = "Channel does not have OpenAI upstream configured";

    await GET(app, "/raw-en-uncatalogued", "en")
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe(raw);
      });

    await GET(app, "/raw-en-uncatalogued", "zh-CN")
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe(raw);
      });
  });

  it("keeps the 401 code mapping for a keyless unauthorized error", async () => {
    const app = createApp();

    await GET(app, "/unauthorized-raw", "en")
      .expect(401)
      .expect(({ body }) => {
        expect(body).toEqual({ code: CustomCode.AUTH_FAILED, message: "Unauthorized access" });
      });
  });

  it("preserves structured fields on ValidationError", async () => {
    const app = createApp();

    const response = await GET(app, "/validation-fields", "zh-CN").expect(HttpStatusCode.UnprocessableEntity);

    expect(response.body).toEqual({
      code: CustomCode.VALIDATION_FAILED,
      message: "参数校验失败",
      fields: {
        "body.email": ["邮箱格式不正确"],
        "body.password": ["密码长度必须为 6 到 50 个字符"],
      },
    });
  });
});

describe("P02 baseline · validation adapters", () => {
  // 本节断言在 P06 被**有意翻转**：旧实现把 TSOA / Zod 的原始英文消息（可能内嵌提交值）
  // 原样透传，顶层只有通用校验失败。P06 后改为结构化规则 + 安全字段提示 + 顶层字段摘要。
  it("never passes through TSOA messages that may contain the submitted value", async () => {
    const app = createApp();

    const response = await GET(app, "/tsoa-validate", "zh-CN").expect(HttpStatusCode.UnprocessableEntity);

    expect(response.body).toEqual({
      code: CustomCode.VALIDATION_FAILED,
      message: "密码的值无效",
      error: "请求校验失败",
      fields: { password: ["密码的值无效"] },
    });
    expect(JSON.stringify(response.body)).not.toContain("p@ss123");
  });

  it("maps Zod issues to safe localized field messages plus a top-level summary", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/zod-validate")
      .set("X-Locale", "zh-CN")
      .send({ flag: "not-a-boolean" })
      .expect(HttpStatusCode.UnprocessableEntity);

    expect(response.body).toEqual({
      code: CustomCode.VALIDATION_FAILED,
      message: "名称为必填项; flag类型不正确，应为 boolean",
      fields: {
        name: ["名称为必填项"],
        flag: ["flag类型不正确，应为 boolean"],
      },
    });
    // 旧的 Zod 英文原文（"Required"）不再外发
    expect(JSON.stringify(response.body)).not.toContain("Required");
  });

  it("localizes the same structured problems for en", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/zod-validate")
      .set("X-Locale", "en")
      .send({ flag: "not-a-boolean" })
      .expect(HttpStatusCode.UnprocessableEntity);

    expect(response.body.fields.flag).toEqual(["flag must be a valid boolean"]);
    expect(response.body.message).toBe("Name is required; flag must be a valid boolean");
  });
});

describe("P02 baseline · infrastructure error mapping", () => {
  it("maps prisma P2002 to 409 without leaking target outside development", async () => {
    const app = createApp();

    const response = await GET(app, "/prisma-unique", "en").expect(HttpStatusCode.Conflict);

    expect(response.body).toEqual({
      code: CustomCode.RESOURCE_ALREADY_EXISTS,
      message: "Resource already exists; please avoid creating or submitting duplicates",
    });
  });

  it("maps JWT errors to 401 and keeps the original error string (P05 to close)", async () => {
    const app = createApp();

    await GET(app, "/jwt-expired", "en")
      .expect(401)
      .expect(({ body }) => {
        expect(body).toEqual({
          code: CustomCode.TOKEN_EXPIRED,
          message: "Token expired",
          error: "jwt expired",
        });
      });

    await GET(app, "/jwt-invalid", "zh-CN")
      .expect(401)
      .expect(({ body }) => {
        expect(body).toEqual({
          code: CustomCode.TOKEN_INVALID,
          message: "Token 无效",
          error: "invalid signature",
        });
      });
  });

  it("reports unknown errors for diagnostics and returns a 500 envelope", async () => {
    const app = createApp();
    const report = vi
      .spyOn(ErrorReportService.getInstance(), "reportServerExceptionSafely")
      .mockImplementation(() => {});

    const response = await GET(app, "/unknown-error", "zh-CN").expect(HttpStatusCode.InternalServerError);

    expect(report).toHaveBeenCalledTimes(1);
    expect(response.body.code).toBe(CustomCode.INTERNAL_SERVER_ERROR);
    // 非 production 环境当前会外发原始异常文本（P05 收口）
    expect(response.body.message).toBe("boom-internal-detail");
    // 非 development 环境不附加 error/stack
    expect(response.body).not.toHaveProperty("error");
    expect(response.body).not.toHaveProperty("stack");
  });
});
