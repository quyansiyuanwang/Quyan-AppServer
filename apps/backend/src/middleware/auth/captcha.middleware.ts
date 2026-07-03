import type { NextFunction, Response } from "express";
import type { TypedRequest } from "@/types/express";
import { CaptchaService } from "@/services/auth/captcha.service";
import { BadRequestError } from "@/util/errors";
import { CustomCode } from "@/constant/custom-code";

export interface CaptchaMiddlewareOptions {
  action: string;
  tokenField?: string;
  requireExplicitToken?: boolean;
  trustOnly?: boolean;
}

function getCaptchaTokenFromBody(req: TypedRequest, tokenField: string): string {
  const body = req.body as Record<string, unknown> | undefined;
  const token = body?.[tokenField];
  return typeof token === "string" ? token : "";
}

export function captchaMiddleware(options: CaptchaMiddlewareOptions) {
  const captchaService = CaptchaService.getInstance();
  const tokenField = options.tokenField || "captchaToken";

  return async (req: TypedRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!(await captchaService.isEnabled())) return next();
      if (await captchaService.shouldBypassForTrustedRequest(req)) return next();

      if (options.trustOnly) throw new BadRequestError("需要先完成人机验证", CustomCode.CAPTCHA_TRUST_REQUIRED);

      const token = getCaptchaTokenFromBody(req, tokenField);
      if (options.requireExplicitToken && !token)
        throw new BadRequestError("缺少 captcha token", CustomCode.VALIDATION_FAILED);

      await captchaService.verifyToken(token, options.action, req);
      next();
    } catch (error) {
      next(error as Error);
    }
  };
}
