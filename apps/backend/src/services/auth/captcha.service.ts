import axios from "axios";
import type { Request } from "express";
import { env } from "@/config/env";
import { ConfigService, type CaptchaConfig, type CaptchaProvider } from "@/services/system/config.service";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import { hasValidCaptchaTrustCookie, setCaptchaTrustCookie } from "@/util/captcha-trust-cookie";
import { extractRelayToken } from "@/util/relay-auth";

const logger = getLogger("CaptchaService", LogCategory.BUSINESS);

interface RecaptchaVerifyResult {
  success: boolean;
  score?: number;
  action?: string;
  challenge_ts?: string;
  hostname?: string;
  "error-codes"?: string[];
}

interface TurnstileVerifyResult {
  success: boolean;
  action?: string;
  cdata?: string;
  challenge_ts?: string;
  hostname?: string;
  metadata?: {
    ephemeral_id?: string;
  };
  "error-codes"?: string[];
}

class CaptchaProviderUnavailableError extends Error {
  constructor(
    public readonly provider: CaptchaProvider,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CaptchaProviderUnavailableError";
  }
}

export class CaptchaService {
  private static instance: CaptchaService;

  private constructor(private readonly configService: ConfigService = ConfigService.getInstance()) {}

  static getInstance(): CaptchaService {
    if (!CaptchaService.instance) CaptchaService.instance = new CaptchaService();

    return CaptchaService.instance;
  }

  async isEnabled(): Promise<boolean> {
    const config = await this.configService.getCaptchaConfig();
    return config.enabled && config.provider !== "none";
  }

  async shouldBypassForTrustedRequest(request?: Request): Promise<boolean> {
    if (!request) return false;

    const config = await this.configService.getCaptchaConfig();
    if (!config.enabled || config.trustWindowMinutes <= 0) return false;
    if (this.isProgrammaticRequest(request)) return false;
    return hasValidCaptchaTrustCookie(request);
  }

  async verifyToken(token: string, expectedAction?: string, request?: Request): Promise<void> {
    const config = await this.configService.getCaptchaConfig();
    if (!config.enabled || config.provider === "none") {
      logger.debug("Captcha verification skipped (disabled)", {
        provider: config.provider,
      });
      return;
    }

    if (!token) throw new BadRequestError("缺少人机验证 token");

    const providers = this.buildProviderChain(config);
    const unavailableErrors: Array<{ provider: CaptchaProvider; message: string }> = [];
    const validationErrors: Array<{ provider: CaptchaProvider; message: string }> = [];
    let lastValidationError: BadRequestError | null = null;

    for (const provider of providers)
      try {
        await this.verifyWithProvider(provider, token, expectedAction, config);
        if (request && !this.isProgrammaticRequest(request) && config.trustWindowMinutes > 0)
          setCaptchaTrustCookie(request, config.trustWindowMinutes * 60);
        return;
      } catch (error) {
        if (error instanceof CaptchaProviderUnavailableError) {
          unavailableErrors.push({ provider: error.provider, message: error.message });
          continue;
        }

        if (error instanceof BadRequestError) {
          lastValidationError = error;
          validationErrors.push({ provider, message: error.message });

          logger.warn("Captcha verification failed for provider, trying next provider if available", {
            provider,
            fallbackProvider: config.fallbackProvider,
            expectedAction,
            message: error.message,
          });
          continue;
        }

        throw error;
      }

    if (lastValidationError) {
      logger.warn("Captcha verification failed for all configured providers", {
        provider: config.provider,
        fallbackProvider: config.fallbackProvider,
        expectedAction,
        errors: validationErrors,
      });
      throw lastValidationError;
    }

    logger.error("Captcha verification unavailable", {
      provider: config.provider,
      fallbackProvider: config.fallbackProvider,
      errors: unavailableErrors,
    });
    throw new BadRequestError("人机验证服务暂时不可用，请稍后重试");
  }

  async verifyTokenWithProvider(
    provider: Exclude<CaptchaProvider, "none">,
    token: string,
    expectedAction?: string,
    request?: Request,
  ): Promise<void> {
    const config = await this.configService.getCaptchaConfig();
    if (!config.enabled) return;
    if (!token) throw new BadRequestError("缺少人机验证 token");

    await this.verifyWithProvider(provider, token, expectedAction, config);
    if (request && !this.isProgrammaticRequest(request) && config.trustWindowMinutes > 0)
      setCaptchaTrustCookie(request, config.trustWindowMinutes * 60);
  }

  private buildProviderChain(config: CaptchaConfig): CaptchaProvider[] {
    const providers = [config.provider, config.fallbackProvider];
    return providers.filter((provider, index) => provider !== "none" && providers.indexOf(provider) === index);
  }

  private isProgrammaticRequest(request: Request): boolean {
    if (extractRelayToken(request)) return true;

    const authHeader = String(request.headers["authorization"] || "").trim();
    if (authHeader.startsWith("Bearer ak_")) return true;

    const typedRequest = request as Request & { accessKey?: unknown; relayToken?: unknown };
    return Boolean(typedRequest.accessKey || typedRequest.relayToken);
  }

  private async verifyWithProvider(
    provider: CaptchaProvider,
    token: string,
    expectedAction: string | undefined,
    config: CaptchaConfig,
  ): Promise<void> {
    switch (provider) {
      case "recaptcha":
        await this.verifyRecaptcha(token, expectedAction, config.minScore);
        return;
      case "turnstile":
        await this.verifyTurnstile(token, expectedAction);
        return;
      default:
        throw new CaptchaProviderUnavailableError(provider, `Unsupported captcha provider: ${provider}`);
    }
  }

  private async verifyRecaptcha(token: string, expectedAction: string | undefined, minScore: number): Promise<void> {
    const secretKey = String(env.auth.recaptcha.secretKey || "").trim();
    if (!secretKey) {
      logger.warn("reCAPTCHA secret key is missing");
      throw new CaptchaProviderUnavailableError("recaptcha", "reCAPTCHA secret key is missing");
    }

    try {
      const params = new URLSearchParams({
        secret: secretKey,
        response: token,
      });
      const response = await axios.post<RecaptchaVerifyResult>(
        "https://recaptcha.net/recaptcha/api/siteverify",
        params,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          timeout: 5000,
        },
      );

      const result = response.data;

      if (!result.success) {
        logger.warn("reCAPTCHA verification failed", {
          errors: result["error-codes"],
        });
        throw new BadRequestError("人机验证失败，请刷新页面重试");
      }

      if (result.score !== undefined && result.score < minScore) {
        logger.warn("reCAPTCHA score too low", {
          score: result.score,
          minScore,
        });
        throw new BadRequestError("人机验证未通过，请稍后重试");
      }

      if (expectedAction && result.action !== expectedAction) {
        logger.warn("reCAPTCHA action mismatch", {
          expected: expectedAction,
          actual: result.action,
        });
        throw new BadRequestError("人机验证失败");
      }

      logger.debug("reCAPTCHA verification successful", {
        score: result.score,
        action: result.action,
      });
    } catch (error) {
      if (error instanceof BadRequestError) throw error;

      logger.error("reCAPTCHA verification error", { error });
      throw new CaptchaProviderUnavailableError("recaptcha", "reCAPTCHA verification request failed", error);
    }
  }

  private async verifyTurnstile(token: string, expectedAction?: string): Promise<void> {
    const secretKey = String(env.auth.turnstile.secretKey || "").trim();
    if (!secretKey) {
      logger.warn("Turnstile secret key is missing");
      throw new CaptchaProviderUnavailableError("turnstile", "Turnstile secret key is missing");
    }

    try {
      const params = new URLSearchParams({
        secret: secretKey,
        response: token,
      });
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) throw new Error(`Turnstile siteverify HTTP ${response.status}`);

      const result = (await response.json()) as TurnstileVerifyResult;

      if (!result.success) {
        logger.warn("Turnstile verification failed", {
          errors: result["error-codes"],
        });
        throw new BadRequestError("人机验证失败，请刷新页面重试");
      }

      if (expectedAction && result.action !== expectedAction) {
        logger.warn("Turnstile action mismatch", {
          expected: expectedAction,
          actual: result.action,
        });
        throw new BadRequestError("人机验证失败");
      }

      logger.debug("Turnstile verification successful", {
        action: result.action,
      });
    } catch (error) {
      if (error instanceof BadRequestError) throw error;

      logger.error("Turnstile verification error", {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
      throw new CaptchaProviderUnavailableError("turnstile", "Turnstile verification request failed", error);
    }
  }
}
