import { Extension } from "@tsoa/runtime";
import { captchaMiddleware, type CaptchaMiddlewareOptions } from "@/middleware/auth/captcha.middleware";

export function CaptchaProtected(options: CaptchaMiddlewareOptions) {
  return Extension("x-captcha-protected", {
    required: true,
    action: options.action,
    tokenField: options.tokenField || "captchaToken",
    requireExplicitToken: options.requireExplicitToken || false,
    trustOnly: options.trustOnly || false,
  });
}

export { captchaMiddleware };
