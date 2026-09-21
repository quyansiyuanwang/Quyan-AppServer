/**
 * P06 — Zod 适配器：中间件只产出**结构化校验模型**，字段消息与顶层摘要在响应边界渲染。
 *
 * 旧实现由中间件直接渲染 `fields`（并依赖 `issue.message` 英文原文），已按计划改为：
 * 中间件归一化 → 出口渲染。本文件同时锁定「归一化结果」与「边界渲染结果」两侧。
 */
import { describe, expect, it, vi } from "vitest";
import { createRelayTokenBodySchema } from "@/api/schema/relay/relay.schema";
import { validateBody } from "@/middleware/validation/zod-validator.middleware";
import { renderValidationFields, summarizeValidationProblems } from "@/util/validation-problems";
import type { ValidationError } from "@/util/errors";

async function runMiddleware(locale: string) {
  const next = vi.fn();
  const middleware = validateBody(createRelayTokenBodySchema);
  const request = {
    body: {
      channelId: "channel-1",
      normalizerConfig: {
        enabled: "true",
        thinkingSignature: false,
        thinkingBudget: false,
        unsupportedImage: false,
      },
    },
  } as any;
  const response = { locals: { locale } } as any;

  await middleware(request, response, next);

  return next.mock.calls[0]?.[0] as ValidationError;
}

describe("zod validator → 结构化校验模型", () => {
  it("produces structured problems instead of a pre-rendered message", async () => {
    const error = await runMiddleware("en");

    expect(error.messageKey).toBe("errors.validationFailed");
    expect(error.fields).toBeUndefined();
    expect(error.problems).toEqual([
      { path: "body.normalizerConfig.enabled", rule: "invalidType", params: { expected: "boolean" } },
    ]);
    // 归一化结果与语言无关：同一请求在任何 locale 下产出相同问题
    expect(await runMiddleware("zh-CN").then((e) => e.problems)).toEqual(error.problems);
  });

  it.each([
    ["en", "normalizerConfig.enabled must be a valid boolean"],
    ["zh-CN", "normalizerConfig.enabled类型不正确，应为 boolean"],
  ] as const)("renders localized problem messages for %s", async (locale, message) => {
    const problems = (await runMiddleware(locale)).problems ?? [];

    expect(renderValidationFields(problems, locale)).toEqual({ "normalizerConfig.enabled": [message] });
    expect(summarizeValidationProblems(problems, locale)).toBe(message);
  });
});
