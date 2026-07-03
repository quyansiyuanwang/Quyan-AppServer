import {
  Body,
  Get,
  Post,
  Route,
  SuccessResponse,
  Response,
  Tags,
  Controller,
  Request,
  Middlewares,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { AuthService } from "@/services/auth/auth.service";
import { CaptchaService } from "@/services/auth/captcha.service";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type {
  LoginDto,
  LoginResponse,
  RefreshDto,
  RefreshResponse,
  VerifyTwoFactorLoginDto,
  VerifyTwoFactorLoginResponse,
  VerifyDto,
  VerifyResponse,
  RegisterDto,
  RegisterResponse,
  AcceptPolicyConsentDto,
  AcceptPolicyConsentResponse,
  SendRegisterVerificationCodeDto,
  SendRegisterVerificationCodeResponse,
  SendPasswordResetCodeDto,
  SendPasswordResetCodeResponse,
  SendTwoFactorEmailCodeDto,
  SendTwoFactorEmailCodeResponse,
  VerifyCaptchaTrustDto,
  VerifyCaptchaTrustResponse,
  LogoutDto,
  LogoutResponse,
  ReplaySigningSessionResponse,
  ResetPasswordDto,
  ResetPasswordResponse,
} from "@/api/dto/auth/auth.dto";
import { getLogger, LogCategory } from "@/util/logger";
import type { Request as ExpressRequest } from "express";
import { RateLimiterService } from "@/services/infrastructure/rate-limiter.service";
import { extractClientIp } from "@/util/ip-extractor";
import { TooManyRequestsError, BadRequestError } from "@/util/errors";
import type { ErrorResponse } from "@/api/response";
import { CustomCode } from "@/constant/custom-code";
import {
  loginBodySchema,
  refreshBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
  acceptPolicyConsentBodySchema,
  sendRegisterVerificationCodeBodySchema,
  sendPasswordResetCodeBodySchema,
  sendTwoFactorEmailCodeBodySchema,
  verifyCaptchaTrustBodySchema,
  verifyTwoFactorLoginBodySchema,
  verifyBodySchema,
  logoutBodySchema,
} from "@/api/schema/auth/auth.schema";
import { validateBody } from "@/middleware/validation";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { CaptchaProtected, captchaMiddleware } from "@/util/captcha-protected-decorator";
import { ConfigService } from "@/services/system/config.service";
import { setResponseMessageKey } from "@/util/response-wrapper";

const logger = getLogger("AuthController", LogCategory.AUTH);

/**
 * 用户认证相关接口
 */
@Route("v1/auth")
@Tags("Authentication")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class AuthController extends Controller {
  private authService = new AuthService();
  private rateLimiterService = RateLimiterService.getInstance();
  private businessLogService = BusinessLogService.getInstance();
  private captchaService = CaptchaService.getInstance();
  private configService = ConfigService.getInstance();

  /**
   * 获取防重放签名会话
   * @summary 获取短期 HMAC 签名会话
   */
  @Get("replay-signing-session")
  @SuccessResponse(HttpStatusCode.Ok, "获取签名会话成功")
  public async getReplaySigningSession(@Request() request: ExpressRequest): Promise<ReplaySigningSessionResponse> {
    setResponseMessageKey(request as never, "auth.replaySigningSessionIssued");
    return this.authService.issueReplaySigningSession(request);
  }

  @Get("captcha/trust-status")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async getCaptchaTrustStatus(
    @Request() request: ExpressRequest,
  ): Promise<{ trusted: boolean; expiresInSeconds: number }> {
    const trusted = await this.captchaService.shouldBypassForTrustedRequest(request);
    const config = await this.configService.getCaptchaConfig();
    return {
      trusted,
      expiresInSeconds: trusted ? Math.max(0, config.trustWindowMinutes) * 60 : 0,
    };
  }

  @Post("captcha/verify-and-trust")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(replayProtectionMiddleware, validateBody(verifyCaptchaTrustBodySchema))
  public async verifyCaptchaTrust(
    @Body() requestBody: VerifyCaptchaTrustDto,
    @Request() request: ExpressRequest,
  ): Promise<VerifyCaptchaTrustResponse> {
    await this.captchaService.verifyTokenWithProvider(
      requestBody.provider,
      requestBody.captchaToken,
      requestBody.action,
      request,
    );
    const config = await this.configService.getCaptchaConfig();
    return {
      trusted: true,
      expiresInSeconds: Math.max(0, config.trustWindowMinutes) * 60,
    };
  }

  /**
   * 用户登录
   * @summary 用户登录
   * @param requestBody 登录信息（用户名 and 密码）
   * @returns 登录成功，返回访问令牌；刷新令牌通过 HttpOnly Cookie 下发
   * @example requestBody {
   *   "username": "admin",
   *   "password": "password123"
   * }
   */
  @Post("login")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "登录成功")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "用户名或密码错误")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "需要重新同意最新协议")
  @CaptchaProtected({ action: "login", trustOnly: true })
  @Middlewares(
    replayProtectionMiddleware,
    validateBody(loginBodySchema),
    captchaMiddleware({ action: "login", trustOnly: true }),
  )
  public async login(@Body() requestBody: LoginDto, @Request() request: ExpressRequest): Promise<LoginResponse> {
    const login_res = await this.authService.login(requestBody.username, requestBody.password, request);
    logger.info("用户登录成功: %s", requestBody.username);
    return login_res;
  }

  /**
   * 刷新访问令牌
   * @summary 刷新令牌
   * @param requestBody 可选请求体；HTTP 请求优先从 HttpOnly Cookie 读取刷新令牌
   * @returns 刷新成功，返回新的访问令牌
   * @example requestBody {
   *   "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   * }
   */
  @Post("refresh")
  @SuccessResponse(HttpStatusCode.Ok, "令牌刷新成功")
  @Middlewares(replayProtectionMiddleware, validateBody(refreshBodySchema))
  public async refresh(@Request() request: ExpressRequest, @Body() requestBody?: RefreshDto): Promise<RefreshResponse> {
    const result = await this.authService.refresh(request, requestBody?.refresh_token);
    logger.info("令牌刷新成功");
    return result;
  }

  /**
   * 登录二次验证
   * @summary 验证 TOTP、邮箱验证码或恢复码并完成登录
   */
  @Post("verify-2fa")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "二次验证登录成功")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "二次验证码错误或会话无效")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "需要重新同意最新协议")
  @Response<ErrorResponse>(429, "请求过于频繁")
  @Middlewares(replayProtectionMiddleware, validateBody(verifyTwoFactorLoginBodySchema))
  public async verifyTwoFactorLogin(
    @Body() requestBody: VerifyTwoFactorLoginDto,
    @Request() request: ExpressRequest,
  ): Promise<VerifyTwoFactorLoginResponse> {
    const clientIp = extractClientIp(request);

    const rateLimitCheck = await this.rateLimiterService.checkTwoFactorVerificationRateLimit(
      clientIp,
      requestBody.challengeToken,
    );

    if (!rateLimitCheck.allowed) {
      const message = this.getTwoFactorRateLimitMessage(rateLimitCheck.reason);
      throw new TooManyRequestsError(message.message, rateLimitCheck.retryAfter, undefined, {
        messageKey: message.key,
      });
    }

    await this.rateLimiterService.logTwoFactorVerificationAttempt(clientIp, requestBody.challengeToken);

    return this.authService.verifyTwoFactorLogin(
      requestBody.challengeToken,
      requestBody.code,
      requestBody.recoveryCode,
      requestBody.emailCode,
      request,
    );
  }

  /**
   * 发送登录二次验证邮箱验证码
   * @summary 发送 2FA 登录邮箱验证码
   */
  @Post("send-2fa-email-code")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "验证码已发送")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "发送失败")
  @Response<ErrorResponse>(429, "请求过于频繁")
  @CaptchaProtected({ action: "send_2fa_email_code", trustOnly: true })
  @Middlewares(
    replayProtectionMiddleware,
    validateBody(sendTwoFactorEmailCodeBodySchema),
    captchaMiddleware({ action: "send_2fa_email_code", trustOnly: true }),
  )
  public async sendTwoFactorEmailCode(
    @Body() requestBody: SendTwoFactorEmailCodeDto,
    @Request() request: ExpressRequest,
  ): Promise<SendTwoFactorEmailCodeResponse> {
    const clientIp = extractClientIp(request);

    const rateLimitCheck = await this.rateLimiterService.checkTwoFactorEmailSendRateLimit(
      clientIp,
      requestBody.challengeToken,
    );

    if (!rateLimitCheck.allowed) {
      const message = this.getTwoFactorEmailSendRateLimitMessage(rateLimitCheck.reason);
      throw new TooManyRequestsError(message.message, rateLimitCheck.retryAfter, undefined, {
        messageKey: message.key,
      });
    }

    await this.rateLimiterService.logTwoFactorEmailSendAttempt(clientIp, requestBody.challengeToken);

    const response = await this.authService.sendTwoFactorEmailCode(requestBody.challengeToken);

    await this.businessLogService.logOperation({
      operationType: OperationType.TWO_FACTOR_EMAIL_CODE_SEND,
      operationCategory: OperationCategory.AUTH,
      description: "发送登录二次验证邮箱验证码",
      success: true,
      ipAddress: clientIp,
      userAgent: request.headers["user-agent"],
      requestId: request.headers["x-request-id"] as string | undefined,
    });

    return response;
  }

  /**
   * 验证访问令牌
   * @summary 验证令牌有效性
   * @param requestBody 包含访问令牌的请求体
   * @returns 令牌有效，返回用户信息
   * @example requestBody {
   *   "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   * }
   */
  @Post("verify")
  @SuccessResponse(HttpStatusCode.Ok, "令牌有效")
  @Middlewares(replayProtectionMiddleware, validateBody(verifyBodySchema))
  public async verify(@Body() requestBody: VerifyDto, @Request() request: ExpressRequest): Promise<VerifyResponse> {
    const result = await this.authService.verify(requestBody.access_token, request);
    logger.info("令牌验证成功");
    return result;
  }

  /**
   * 发送注册邮箱验证码
   * @summary 发送注册验证码
   */
  @Post("send-register-verification-code")
  @SuccessResponse(HttpStatusCode.Ok, "验证码已发送")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "发送失败")
  @Response<ErrorResponse>(429, "请求过于频繁")
  @CaptchaProtected({ action: "send_verification_code", trustOnly: true })
  @Middlewares(
    replayProtectionMiddleware,
    validateBody(sendRegisterVerificationCodeBodySchema),
    captchaMiddleware({ action: "send_verification_code", trustOnly: true }),
  )
  public async sendRegisterVerificationCode(
    @Body() requestBody: SendRegisterVerificationCodeDto,
    @Request() request: ExpressRequest,
  ): Promise<SendRegisterVerificationCodeResponse> {
    const clientIp = extractClientIp(request);
    const email = requestBody.email;

    // 第二层：检查频率限制
    const rateLimitCheck = await this.rateLimiterService.checkEmailVerificationRateLimit(clientIp, email);

    if (!rateLimitCheck.allowed) {
      const message = this.getRateLimitMessage(rateLimitCheck.reason);
      throw new TooManyRequestsError(message.message, rateLimitCheck.retryAfter, undefined, {
        messageKey: message.key,
      });
    }

    // 发送验证码
    await this.authService.sendVerificationCode(email);

    // 记录请求
    await this.rateLimiterService.logEmailVerificationRequest(clientIp, email);

    setResponseMessageKey(request as never, "auth.verificationCodeSent");
    return { message: "验证码已发送" };
  }

  /**
   * 发送找回密码邮箱验证码
   * @summary 发送找回密码验证码
   */
  @Post("send-password-reset-code")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "验证码已发送")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "发送失败")
  @Response<ErrorResponse>(429, "请求过于频繁")
  @CaptchaProtected({ action: "send_password_reset_code", trustOnly: true })
  @Middlewares(
    replayProtectionMiddleware,
    validateBody(sendPasswordResetCodeBodySchema),
    captchaMiddleware({ action: "send_password_reset_code", trustOnly: true }),
  )
  public async sendPasswordResetCode(
    @Body() requestBody: SendPasswordResetCodeDto,
    @Request() request: ExpressRequest,
  ): Promise<SendPasswordResetCodeResponse> {
    const clientIp = extractClientIp(request);
    const email = requestBody.email;

    const rateLimitCheck = await this.rateLimiterService.checkPasswordResetCodeRateLimit(clientIp, email);

    if (!rateLimitCheck.allowed) {
      const message = this.getRateLimitMessage(rateLimitCheck.reason);
      throw new TooManyRequestsError(message.message, rateLimitCheck.retryAfter, undefined, {
        messageKey: message.key,
      });
    }

    await this.authService.sendPasswordResetCode(requestBody.username, email);
    await this.rateLimiterService.logPasswordResetCodeRequest(clientIp, email);

    setResponseMessageKey(request as never, "auth.passwordResetCodeSent");
    return { message: "密码重置验证码已发送" };
  }

  /**
   * 通过邮箱验证码重置密码
   * @summary 重置密码
   */
  @Post("reset-password")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "密码重置成功")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "密码重置失败")
  @CaptchaProtected({ action: "reset_password", trustOnly: true })
  @Middlewares(
    replayProtectionMiddleware,
    validateBody(resetPasswordBodySchema),
    captchaMiddleware({ action: "reset_password", trustOnly: true }),
  )
  public async resetPassword(
    @Body() requestBody: ResetPasswordDto,
    @Request() request: ExpressRequest,
  ): Promise<ResetPasswordResponse> {
    const result = await this.authService.resetPassword(requestBody, request);
    setResponseMessageKey(request as never, "auth.passwordResetSuccess");
    logger.info("用户重置密码成功", {
      username: requestBody.username,
      email: requestBody.email,
    });
    return result;
  }

  /**
   * 获取频率限制错误消息
   */
  private getRateLimitMessage(reason?: string): {
    key: "auth.rateLimit.ip" | "auth.rateLimit.email" | "errors.tooManyRequests";
    message: string;
  } {
    switch (reason) {
      case "IP_RATE_LIMIT_EXCEEDED":
        return { key: "auth.rateLimit.ip", message: "您的 IP 地址请求过于频繁，请稍后再试" };
      case "IP_EMAIL_RATE_LIMIT_EXCEEDED":
        return { key: "auth.rateLimit.email", message: "该邮箱地址请求过于频繁，请稍后再试" };
      default:
        return { key: "errors.tooManyRequests", message: "请求过于频繁，请稍后再试" };
    }
  }

  /**
   * 获取 2FA 频率限制错误消息
   */
  private getTwoFactorRateLimitMessage(reason?: string): {
    key: "auth.twoFactorRateLimit.ip" | "auth.twoFactorRateLimit.challenge" | "errors.tooManyRequests";
    message: string;
  } {
    switch (reason) {
      case "TWO_FACTOR_IP_RATE_LIMIT_EXCEEDED":
        return { key: "auth.twoFactorRateLimit.ip", message: "您的验证请求过于频繁，请稍后再试" };
      case "TWO_FACTOR_CHALLENGE_RATE_LIMIT_EXCEEDED":
        return {
          key: "auth.twoFactorRateLimit.challenge",
          message: "当前验证会话尝试次数过多，请重新登录后再试",
        };
      default:
        return { key: "errors.tooManyRequests", message: "请求过于频繁，请稍后再试" };
    }
  }

  /**
   * 获取 2FA 邮箱验证码发送频率限制错误消息
   */
  private getTwoFactorEmailSendRateLimitMessage(reason?: string): {
    key: "auth.twoFactorEmailRateLimit.ip" | "auth.twoFactorEmailRateLimit.challenge" | "errors.tooManyRequests";
    message: string;
  } {
    switch (reason) {
      case "TWO_FACTOR_EMAIL_SEND_IP_RATE_LIMIT_EXCEEDED":
        return {
          key: "auth.twoFactorEmailRateLimit.ip",
          message: "您的验证码发送请求过于频繁，请稍后再试",
        };
      case "TWO_FACTOR_EMAIL_SEND_CHALLENGE_RATE_LIMIT_EXCEEDED":
        return {
          key: "auth.twoFactorEmailRateLimit.challenge",
          message: "当前验证会话发送次数过多，请稍后再试",
        };
      default:
        return { key: "errors.tooManyRequests", message: "请求过于频繁，请稍后再试" };
    }
  }

  /**
   * 用户注册
   * @summary 用户注册
   */
  @Post("register")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "注册成功")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "注册失败")
  @CaptchaProtected({ action: "register", trustOnly: true })
  @Middlewares(
    replayProtectionMiddleware,
    validateBody(registerBodySchema),
    captchaMiddleware({ action: "register", trustOnly: true }),
  )
  public async register(
    @Body() requestBody: RegisterDto,
    @Request() request: ExpressRequest,
  ): Promise<RegisterResponse> {
    const result = await this.authService.register(requestBody, request);
    logger.info("用户注册成功: %s", requestBody.username);
    return result;
  }

  /**
   * 同意最新服务协议与隐私政策并完成登录
   * @summary 协议确认完成登录
   */
  @Post("accept-policy-consent")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "协议确认成功")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "协议确认失败")
  @Middlewares(replayProtectionMiddleware, validateBody(acceptPolicyConsentBodySchema))
  public async acceptPolicyConsent(
    @Body() requestBody: AcceptPolicyConsentDto,
    @Request() request: ExpressRequest,
  ): Promise<AcceptPolicyConsentResponse> {
    return this.authService.acceptPolicyConsent(requestBody, request);
  }

  /**
   * 用户登出
   * @summary 用户登出（优先撤销 Cookie 中的 refresh token，并回退读取 Authorization Bearer）
   */
  @Post("logout")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "登出成功")
  @Middlewares(replayProtectionMiddleware, validateBody(logoutBodySchema))
  public async logout(@Body() requestBody: LogoutDto, @Request() request: ExpressRequest): Promise<LogoutResponse> {
    await this.authService.logoutWithRequest(request, requestBody.access_token, requestBody.refresh_token);
    logger.info("用户登出成功");
    setResponseMessageKey(request as never, "auth.logoutSuccess");
    return { message: "登出成功" };
  }
}
