/**
 * P06 — Zod/TSOA/业务校验适配
 *
 * 覆盖计划 §3.3 与 P06 完成标准：
 * 1. 字段消息与顶层摘要**具体、安全、本地化**：结构化规则 → `validation.*` 模板，不解析英文原句；
 * 2. **绝不回显用户提交值**：参数只允许安全标量；无法识别规则时回退到字段级「无效值」提示；
 * 3. 顶层摘要**至多 3 项、总长 ≤240 字符**，超出提示查看字段详情；限额集中在呈现策略；
 * 4. **已有明确业务原因优先于自动摘要**（自定义 refine 必须显式携带描述符）；
 * 5. 字段显示名走领域映射，未知字段回退到安全路径（不泄露原始输入）。
 */
import { describe, expect, it } from "vitest";
import type { ZodIssue } from "zod";
import { ValidateError } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { z } from "zod";
import { localeMiddleware } from "@/middleware/locale";
import { responseWrapperMiddleware } from "@/middleware/response-wrapper";
import { exceptionMiddleware } from "@/middleware/exception";
import { validateBody } from "@/middleware/validation/zod-validator.middleware";
import { CustomCode } from "@/constant/custom-code";
import { ValidationError } from "@/util/errors";
import {
  VALIDATION_PRESENTATION,
  fieldLabel,
  normalizeFieldPath,
  problemFromTsoaEnumField,
  problemFromTsoaField,
  problemFromZodIssue,
  renderValidationFields,
  summarizeValidationProblems,
  type ValidationProblem,
} from "@/util/validation-problems";

const SECRET = "p@ss123-secret";

describe("P06 · Zod 结构化映射", () => {
  const issue = (partial: Partial<ZodIssue>): ZodIssue => partial as ZodIssue;

  it("maps missing values to required and type mismatches to invalidType", () => {
    expect(
      problemFromZodIssue(
        issue({ code: "invalid_type", expected: "string", received: "undefined", path: [] } as never),
        "body",
      ),
    ).toEqual({ path: "body", rule: "required" });
    expect(
      problemFromZodIssue(
        issue({ code: "invalid_type", expected: "string", received: "number", path: ["email"] } as never),
        "body",
      ),
    ).toEqual({ path: "body.email", rule: "invalidType", params: { expected: "string" } });
  });

  it("distinguishes length from range and keeps nested/array paths", () => {
    expect(
      problemFromZodIssue(issue({ code: "too_small", type: "string", minimum: 3, path: ["name"] } as never), "body"),
    ).toEqual({ path: "body.name", rule: "tooShort", params: { min: 3 } });
    expect(
      problemFromZodIssue(issue({ code: "too_big", type: "string", maximum: 50, path: ["password"] } as never), "body"),
    ).toEqual({ path: "body.password", rule: "tooLong", params: { max: 50 } });
    expect(
      problemFromZodIssue(issue({ code: "too_small", type: "number", minimum: 1, path: ["limit"] } as never), "body"),
    ).toEqual({ path: "body.limit", rule: "tooSmall", params: { min: 1 } });
    expect(
      problemFromZodIssue(
        issue({ code: "invalid_type", expected: "string", received: "number", path: ["items", 0, "name"] } as never),
        "body",
      ),
    ).toEqual({ path: "body.items.0.name", rule: "invalidType", params: { expected: "string" } });
  });

  it("maps format, enum and unknown-field rules without echoing values", () => {
    expect(
      problemFromZodIssue(issue({ code: "invalid_string", validation: "email", path: ["email"] } as never), "body"),
    ).toEqual({ path: "body.email", rule: "invalidFormat" });
    expect(
      problemFromZodIssue(issue({ code: "invalid_enum_value", options: ["a", "b"], path: ["mode"] } as never), "body"),
    ).toEqual({ path: "body.mode", rule: "invalidEnum", params: { values: "a, b" } });
    expect(
      problemFromZodIssue(issue({ code: "unrecognized_keys", keys: ["rogue"], path: [] } as never), "body"),
    ).toEqual({ path: "body.rogue", rule: "unknownField" });
  });

  it("falls back to a safe invalid-value problem for unrecognised and custom issues", () => {
    expect(
      problemFromZodIssue(issue({ code: "custom", message: `value ${SECRET} is bad`, path: ["x"] } as never), "body"),
    ).toEqual({
      path: "body.x",
      rule: "invalidValue",
    });
    expect(
      JSON.stringify(problemFromZodIssue(issue({ code: "not_finite", path: ["n"] } as never), "body")),
    ).not.toContain(SECRET);
  });

  it("accepts an explicit descriptor from a custom refinement", () => {
    const problem = problemFromZodIssue(
      issue({
        code: "custom",
        path: ["channelId"],
        params: { messageKey: "relay.poolMembersRequired" },
      } as never),
      "body",
    );

    expect(problem.rule).toBe("invalidValue");
    expect(problem.descriptor).toEqual({ key: "relay.poolMembersRequired", params: undefined });
  });
});

describe("P06 · 安全路径与字段显示名", () => {
  it("normalizes paths and strips request-part prefixes", () => {
    expect(normalizeFieldPath("body.email")).toBe("email");
    expect(normalizeFieldPath("query.pageSize")).toBe("pageSize");
    expect(normalizeFieldPath("body.items.0.name")).toBe("items[].name");
  });

  it("replaces unsafe characters and caps path length", () => {
    const hostile = `body.<script>alert(1)</script>${"x".repeat(200)}`;

    expect(normalizeFieldPath(hostile)).not.toContain("<");
    expect(normalizeFieldPath(hostile)).not.toContain("(");
    expect(normalizeFieldPath(hostile).length).toBeLessThanOrEqual(VALIDATION_PRESENTATION.maxPathLength);
  });

  it("uses the domain label when known and the safe path otherwise", () => {
    expect(fieldLabel("body.email", "en")).toBe("Email");
    expect(fieldLabel("body.email", "zh-CN")).toBe("邮箱");
    expect(fieldLabel("body.somethingCustom", "en")).toBe("somethingCustom");
  });
});

describe("P06 · 字段消息与顶层摘要", () => {
  const problems: ValidationProblem[] = [
    { path: "body.email", rule: "invalidFormat" },
    { path: "body.password", rule: "tooShort", params: { min: 6 } },
    { path: "body.username", rule: "required" },
    { path: "body.name", rule: "tooLong", params: { max: 20 } },
  ];

  it("renders localized field messages with display names", () => {
    expect(renderValidationFields(problems.slice(0, 2), "en")).toEqual({
      email: ["Email is not in a valid format"],
      password: ["Password must be at least 6 characters"],
    });
    expect(renderValidationFields(problems.slice(0, 2), "zh-CN")).toEqual({
      email: ["邮箱格式不正确"],
      password: ["密码长度至少为 6 个字符"],
    });
  });

  it("caps the summary at the configured item count and adds a details hint", () => {
    const summary = summarizeValidationProblems(problems, "en");

    const shown = summary.split("; ");
    expect(shown).toHaveLength(VALIDATION_PRESENTATION.maxSummaryItems + 1);
    expect(shown.at(-1)).toBe("see field details for the remaining issues");
    expect(summary).not.toContain("Name must be at most 20 characters");
  });

  it("caps the summary total length", () => {
    const long: ValidationProblem[] = Array.from({ length: 3 }, (_, index) => ({
      path: `body.field${index}`,
      rule: "tooLong",
      params: { max: 999999 },
    }));

    expect(summarizeValidationProblems(long, "en").length).toBeLessThanOrEqual(
      VALIDATION_PRESENTATION.maxSummaryLength + 60,
    );
  });

  it("prefers an explicit business descriptor over the generic rule template", () => {
    const withDescriptor: ValidationProblem[] = [
      { path: "body.channelId", rule: "invalidValue", descriptor: { key: "relay.poolMembersRequired" } },
    ];

    const rendered = renderValidationFields(withDescriptor, "zh-CN");
    expect(rendered.channelId).toEqual(["混池渠道至少需要一个成员渠道"]);
    expect(summarizeValidationProblems(withDescriptor, "zh-CN")).toBe("混池渠道至少需要一个成员渠道");
  });

  it("falls back to a safe message when a descriptor is unusable", () => {
    const broken: ValidationProblem[] = [
      { path: "body.x", rule: "invalidValue", descriptor: { key: "does.not.exist" } as never },
    ];

    const rendered = renderValidationFields(broken, "zh-CN");
    expect(rendered.x?.[0]).not.toContain("{{");
    expect(rendered.x?.[0]).not.toContain("does.not.exist");
  });
});

describe("P06 · TSOA 模板识别与安全回退", () => {
  it("recognizes the version-pinned template grammar", () => {
    expect(problemFromTsoaField("name", "'name' is required")).toEqual({ path: "name", rule: "required" });
    expect(problemFromTsoaField("age", "min 1")).toEqual({
      path: "age",
      rule: "tooSmall",
      params: { min: 1 },
    });
    expect(problemFromTsoaField("name", "maxLength 20")).toEqual({
      path: "name",
      rule: "tooLong",
      params: { max: 20 },
    });
    expect(problemFromTsoaField("paid", "invalid boolean value")).toEqual({
      path: "paid",
      rule: "invalidType",
      params: { expected: "boolean" },
    });
    expect(problemFromTsoaField("mode", "should be one of the following; ['a','b']")).toEqual({
      path: "mode",
      rule: "invalidValue",
    });
    expect(problemFromTsoaEnumField("mode", "should be one of the following; ['a','b']")).toEqual({
      path: "mode",
      rule: "invalidEnum",
      params: { values: "a, b" },
    });
  });

  it("never passes through unrecognised (possibly value-bearing) messages", () => {
    const hostile = problemFromTsoaField(
      "password",
      `password must be at least 8 characters, but the value was '${SECRET}'`,
    );

    expect(hostile).toEqual({ path: "password", rule: "invalidValue" });
    expect(JSON.stringify(hostile)).not.toContain(SECRET);
  });
});

describe("P06 · 出口集成", () => {
  function createApp() {
    const app = express();
    app.use(express.json());
    app.use(localeMiddleware);
    app.use(responseWrapperMiddleware);

    const schema = z.object({ email: z.string().email(), password: z.string().min(6) });
    app.post("/zod", validateBody(schema), (_req: Request, res: Response) => {
      res.json({ ok: true });
    });

    app.get("/business", () => {
      throw new ValidationError("Validation failed", undefined, undefined, {
        messageKey: "relay.poolMembersRequired",
      }).withProblems([{ path: "body.email", rule: "invalidFormat" }]);
    });

    app.get("/tsoa", () => {
      throw new ValidateError(
        { password: { message: `invalid, got '${SECRET}'`, value: SECRET } },
        "Validation failed",
      );
    });

    app.use(exceptionMiddleware);

    return app;
  }

  it("returns structured fields and a summary for zod failures", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/zod")
      .set("X-Locale", "zh-CN")
      .send({ email: "not-an-email", password: "123" })
      .expect(HttpStatusCode.UnprocessableEntity);

    expect(response.body.code).toBe(CustomCode.VALIDATION_FAILED);
    expect(response.body.fields).toEqual({
      email: ["邮箱格式不正确"],
      password: ["密码长度至少为 6 个字符"],
    });
    expect(response.body.message).toBe("邮箱格式不正确; 密码长度至少为 6 个字符");
    expect(JSON.stringify(response.body)).not.toContain("123");
  });

  it("keeps the explicit business reason when the failure is not a generic validation failure", async () => {
    const app = createApp();

    const response = await request(app).get("/business").set("X-Locale", "zh-CN").expect(422);

    expect(response.body.message).toBe("混池渠道至少需要一个成员渠道");
    expect(response.body.fields).toEqual({ email: ["邮箱格式不正确"] });
  });

  it("never echoes submitted values for TSOA failures", async () => {
    const app = createApp();

    const response = await request(app).get("/tsoa").set("X-Locale", "zh-CN").expect(422);

    expect(JSON.stringify(response.body)).not.toContain(SECRET);
    expect(response.body.fields).toEqual({ password: ["密码的值无效"] });
  });
});
