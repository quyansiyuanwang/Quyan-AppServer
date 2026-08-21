import { describe, expect, it, vi } from "vitest";
import { createRelayTokenBodySchema } from "@/api/schema/relay/relay.schema";
import { validateBody } from "@/middleware/validation/zod-validator.middleware";

describe("zod validator locale handling", () => {
  it.each([
    ["en", "body.normalizerConfig.enabled must be a boolean"],
    ["zh-CN", "body.normalizerConfig.enabled 必须为布尔值"],
  ] as const)("localizes token normalizer validation details for %s", async (locale, message) => {
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

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0]?.[0];
    expect(error.message).toBe(locale === "en" ? "Validation failed" : "参数校验失败");
    expect(error.messageKey).toBe("errors.validationFailed");
    expect(error.fields).toEqual({ "body.normalizerConfig.enabled": [message] });
  });
});
