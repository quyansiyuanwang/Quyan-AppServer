/**
 * P05 — 统一异常与显式响应渲染
 *
 * 覆盖计划 §3.2 与 P05 完成标准：
 * 1. **2xx 业务失败与非 2xx 一致**：同一失败无论走 `throw`（异常出口）还是显式响应
 *    （`sendApplicationError`）还是 2xx 信封，`code` / `message` 与附加字段都相同。
 * 2. **无重复翻译**：已渲染的消息不再进入第二次翻译；`resolveResponseMessage` 的优先级
 *    「已渲染 → 描述符 → 遗留原文 → 默认 key」是唯一裁决点。
 * 3. **无 key/占位符/内部诊断泄露**：描述符缺参时回退到安全消息，只记日志不外发。
 * 4. **领域 message 不误改**：正常领域对象里的 `message` 字段保持原样。
 * 5. **适配器边界不被破坏**：`skipResponseWrapper` 的响应完全不受影响。
 * 6. **locale 只来自请求上下文**：并发请求互不污染。
 */
import express, { type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { HttpStatusCode } from "axios";
import { localeMiddleware } from "@/middleware/locale";
import { responseWrapperMiddleware } from "@/middleware/response-wrapper";
import { exceptionMiddleware } from "@/middleware/exception";
import { CustomCode } from "@/constant/custom-code";
import { BadRequestError } from "@/util/errors";
import { setResponseMessageKey, skipResponseWrapper } from "@/util/response-wrapper";
import { resolveResponseMessage, sendApplicationError, type ApplicationErrorInit } from "@/util/response-renderer";
import { translateKnownMessage } from "@/locales";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(localeMiddleware);
  app.use(responseWrapperMiddleware);

  // 同一失败 · 路径 A：抛异常
  app.get("/throw-raw", () => {
    throw new BadRequestError("用户组不存在");
  });

  // 同一失败 · 路径 B：显式响应
  app.get("/explicit-raw", (req: Request, res: Response) => {
    sendApplicationError(
      res,
      { statusCode: HttpStatusCode.BadRequest, code: CustomCode.VALIDATION_FAILED, message: "用户组不存在" },
      req,
    );
  });

  // 同一失败 · 路径 C：2xx 信封（业务失败但 HTTP 200）
  app.get("/envelope-2xx", (_req: Request, res: Response) => {
    res.json({ code: CustomCode.VALIDATION_FAILED, message: "用户组不存在" });
  });

  // 描述符路径，且带附加字段
  app.get("/descriptor-with-extras", (req: Request, res: Response) => {
    sendApplicationError(
      res,
      {
        statusCode: HttpStatusCode.NotFound,
        code: CustomCode.NOT_FOUND,
        descriptor: { key: "ipBlacklist.notFoundByIp", params: { ip: "10.0.0.9" } },
        fields: { "body.email": ["Invalid email"] },
        data: { retryAfter: 3 },
        retryAfter: 3,
      },
      req,
    );
  });

  // 描述符缺参：必须回退到安全消息且不泄露 key / 占位符
  app.get("/descriptor-broken", (req: Request, res: Response) => {
    const init = {
      statusCode: HttpStatusCode.BadRequest,
      code: CustomCode.VALIDATION_FAILED,
      descriptor: { key: "ipBlacklist.notFoundByIp" },
    } as ApplicationErrorInit;
    sendApplicationError(res, init, req);
  });

  // 适配器边界：完全跳过包装与本地化
  app.get("/adapter-boundary", (req: Request, res: Response) => {
    skipResponseWrapper(req as never);
    res.status(HttpStatusCode.BadRequest).json({ code: CustomCode.VALIDATION_FAILED, message: "用户组不存在" });
  });

  // 领域对象自带 message 字段（不是响应消息）
  app.get("/domain-message-field", (_req: Request, res: Response) => {
    res.json({ id: "group-1", message: "A captured domain message" });
  });

  // 已渲染消息 + 描述符同时存在：以已渲染为准
  app.get("/already-rendered", (req: Request, res: Response) => {
    sendApplicationError(
      res,
      {
        statusCode: HttpStatusCode.BadRequest,
        code: CustomCode.VALIDATION_FAILED,
        descriptor: { key: "user.deleted" },
      },
      req,
    );
  });

  app.use((_req: Request, res: Response) => {
    res.status(HttpStatusCode.NotFound).json({ code: CustomCode.NOT_FOUND, message: "Not Found" });
  });

  app.use(exceptionMiddleware);

  return app;
}

const GET = (app: express.Express, path: string, locale: string) => request(app).get(path).set("X-Locale", locale);

describe("P05 · 同一失败在三条路径上一致", () => {
  it("produces the same code and message for throw, explicit response and 2xx envelope", async () => {
    const app = createApp();

    for (const locale of ["en", "zh-CN"]) {
      const expected = locale === "en" ? "User group does not exist" : "用户组不存在";
      const thrown = await GET(app, "/throw-raw", locale).expect(400);
      const explicit = await GET(app, "/explicit-raw", locale).expect(400);
      const envelope = await GET(app, "/envelope-2xx", locale).expect(200);

      expect(explicit.body).toEqual(thrown.body);
      // 2xx 业务失败与非 2xx 的差异只在 HTTP 状态上，信封内容一致
      expect(envelope.body).toEqual(thrown.body);
      expect(thrown.body).toEqual({ code: CustomCode.VALIDATION_FAILED, message: expected });
    }
  });

  it("never leaks the message key or residual placeholders when a descriptor is incomplete", async () => {
    const app = createApp();

    for (const locale of ["en", "zh-CN"]) {
      const response = await GET(app, "/descriptor-broken", locale).expect(400);

      expect(response.body.message).not.toContain("ipBlacklist.notFoundByIp");
      expect(response.body.message).not.toContain("{{");
      expect(response.body.message).not.toContain("}}");
      expect(JSON.stringify(response.body)).not.toContain("ipBlacklist");
      expect(response.body.code).toBe(CustomCode.VALIDATION_FAILED);
    }
  });

  it("preserves fields, data and Retry-After for explicit failures", async () => {
    const app = createApp();

    const response = await GET(app, "/descriptor-with-extras", "en").expect(404);

    expect(response.headers["retry-after"]).toBe("3");
    expect(response.body).toEqual({
      code: CustomCode.NOT_FOUND,
      message: "IP 10.0.0.9 is not blacklisted",
      fields: { "body.email": ["Invalid email"] },
      data: { retryAfter: 3 },
    });

    const zh = await GET(app, "/descriptor-with-extras", "zh-CN").expect(404);
    expect(zh.body.message).toBe("IP 10.0.0.9 不在黑名单中");
  });
});

describe("P05 · 无重复翻译", () => {
  it("prefers an already-rendered message over descriptor and legacy lookup", () => {
    const locale = "zh-CN";

    // 已渲染优先：即使同时给了描述符，也绝不再渲染一次
    expect(resolveResponseMessage({ rendered: "已渲染文本", descriptor: { key: "user.deleted" } }, locale)).toBe(
      "已渲染文本",
    );
    // 描述符优先于遗留原文
    expect(resolveResponseMessage({ descriptor: { key: "user.deleted" }, rawMessage: "用户组不存在" }, locale)).toBe(
      "删除成功",
    );
    // 无描述符时走遗留原文反查
    expect(resolveResponseMessage({ rawMessage: "用户组不存在" }, locale)).toBe("用户组不存在");
    // 都没有时用默认 key
    expect(resolveResponseMessage({ defaultKey: "common.success" }, locale)).toBe("操作成功");
  });

  it("renders an explicit failure exactly once at the boundary", async () => {
    const app = createApp();

    const response = await GET(app, "/already-rendered", "en").expect(400);

    // 描述符只被渲染一次：结果等于单次渲染值，而不是被再次当作原文查表
    expect(response.body.message).toBe(translateKnownMessage("Deleted successfully", "en"));
    expect(response.body.message).toBe("Deleted successfully");
  });

  it("keeps a domain object's own message field untouched", async () => {
    const app = createApp();

    await GET(app, "/domain-message-field", "zh-CN")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          code: CustomCode.OK,
          message: "操作成功",
          data: { id: "group-1", message: "A captured domain message" },
        });
      });
  });
});

describe("P05 · 适配器边界", () => {
  it("leaves skipResponseWrapper responses completely untouched", async () => {
    const app = createApp();

    for (const locale of ["en", "zh-CN"]) {
      const response = await GET(app, "/adapter-boundary", locale).expect(400);
      expect(response.body).toEqual({ code: CustomCode.VALIDATION_FAILED, message: "用户组不存在" });
    }
  });

  it("leaves non-envelope bodies alone", async () => {
    const app = express();
    app.use(localeMiddleware);
    app.use(responseWrapperMiddleware);
    app.get("/array", (_req, res) => {
      res.status(400).json([{ message: "用户组不存在" }]);
    });
    app.use(exceptionMiddleware);

    const response = await GET(app, "/array", "en").expect(400);
    expect(response.body).toEqual([{ message: "用户组不存在" }]);
  });

  it("keeps the 404 catch-all message key path intact", async () => {
    const app = createApp();

    await GET(app, "/missing", "en")
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe("Not Found");
      });
  });
});

describe("P05 · 成功消息仍走同一渲染入口", () => {
  it("renders a success descriptor through the shared resolver", async () => {
    const app = express();
    app.use(localeMiddleware);
    app.use(responseWrapperMiddleware);
    app.get("/ok", (req: Request, res: Response) => {
      setResponseMessageKey(req as never, "user.deleted");
      res.json({ ok: true });
    });
    app.use(exceptionMiddleware);

    await GET(app, "/ok", "zh-CN")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ code: CustomCode.OK, message: "删除成功", data: { ok: true } });
      });
  });

  it("isolates concurrent requests per locale on the unified error path", async () => {
    const app = createApp();
    const locales = ["zh-CN", "en", "zh-CN", "en", "zh-CN", "en"];

    const responses = await Promise.all(locales.map((locale) => GET(app, "/throw-raw", locale).expect(400)));

    responses.forEach((response, index) => {
      const expected = locales[index] === "en" ? "User group does not exist" : "用户组不存在";
      expect(response.body.message).toBe(expected);
    });
  });
});
