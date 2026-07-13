import {
  Body,
  Get,
  Path,
  Query,
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
  StartExternalAuthDto,
  StartExternalAuthResponse,
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
  ExternalAuthCallbackResponse,
  BindExternalIdentityDto,
  BindExternalIdentityResponse,
  ListExternalIdentitiesResponse,
  UnbindExternalIdentityDto,
  UnbindExternalIdentityResponse,
  CreateQrLoginSessionResponse,
  ScanQrLoginDto,
  ConfirmQrLoginDto,
  QrLoginSessionStatusResponse,
} from "@/api/dto/auth/auth.dto";
import { getLogger, LogCategory } from "@/util/logger";
import type { Request as ExpressRequest } from "express";
import type { TypedRequest } from "@/types/express";
import { extractClientIp } from "@/util/ip-extractor";
import type { ErrorResponse } from "@/api/response";
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
  startExternalAuthBodySchema,
  externalAuthCallbackQuerySchema,
  bindExternalIdentityBodySchema,
  unbindExternalIdentityBodySchema,
  scanQrLoginBodySchema,
  confirmQrLoginBodySchema,
  qrLoginStatusQuerySchema,
} from "@/api/schema/auth/auth.schema";
import { validateBody, validateQuery } from "@/middleware/validation";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { CaptchaProtected, captchaMiddleware } from "@/util/captcha-protected-decorator";
import { ConfigService } from "@/services/system/config.service";
import { setResponseMessageKey, skipResponseWrapper } from "@/util/response-wrapper";
import { Security } from "@tsoa/runtime";
import { ExternalAuthService } from "@/services/auth/external-auth.service";
import {
  emailVerificationRateLimitMiddleware,
  passwordResetCodeRateLimitMiddleware,
  twoFactorEmailSendRateLimitMiddleware,
  verifyTwoFactorRateLimitMiddleware,
} from "@/middleware/rate-limit-policies";

const logger = getLogger("AuthController", LogCategory.AUTH);

/**
 * 用户认证相关接口
 */
@Route("v1/auth")
@Tags("Authentication")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class AuthController extends Controller {
  private authService = new AuthService();
  private externalAuthService = ExternalAuthService.getInstance();
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

  @Post("external/start")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "获取外部登录地址成功")
  @Middlewares(replayProtectionMiddleware, validateBody(startExternalAuthBodySchema))
  public async startExternalAuth(
    @Body() requestBody: StartExternalAuthDto,
    @Request() request: TypedRequest,
  ): Promise<StartExternalAuthResponse> {
    return this.externalAuthService.startAuth(
      requestBody.provider,
      requestBody.action,
      requestBody.redirectUri,
      request.user?.userId,
      request,
    );
  }

  @Get("external/{provider}/callback")
  @SuccessResponse(HttpStatusCode.Ok, "外部登录回调成功")
  @Middlewares(validateQuery(externalAuthCallbackQuerySchema))
  public async externalAuthCallback(
    @Path() provider: StartExternalAuthDto["provider"],
    @Request() request: ExpressRequest,
    @Query() code?: string,
    @Query() state?: string,
  ): Promise<ExternalAuthCallbackResponse> {
    if (!code || !state) throw new Error("Missing external auth callback query params");
    return this.externalAuthService.handleCallback(provider, code, state, request);
  }

  @Get("external/identities")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取绑定账号成功")
  public async listExternalIdentities(@Request() request: TypedRequest): Promise<ListExternalIdentitiesResponse> {
    return this.externalAuthService.listIdentities(request.user!.userId);
  }

  @Post("external/bind")
  @Security("jwt")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "绑定外部账号成功")
  @Middlewares(replayProtectionMiddleware, validateBody(bindExternalIdentityBodySchema))
  public async bindExternalIdentity(
    @Body() requestBody: BindExternalIdentityDto,
    @Request() request: TypedRequest,
  ): Promise<BindExternalIdentityResponse> {
    return this.externalAuthService.bindIdentity(
      request.user!.userId,
      requestBody.provider,
      requestBody.bindingToken,
      request,
    );
  }

  @Post("external/unbind")
  @Security("jwt")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "解绑外部账号成功")
  @Middlewares(replayProtectionMiddleware, validateBody(unbindExternalIdentityBodySchema))
  public async unbindExternalIdentity(
    @Body() requestBody: UnbindExternalIdentityDto,
    @Request() request: TypedRequest,
  ): Promise<UnbindExternalIdentityResponse> {
    return this.externalAuthService.unbindIdentity(request.user!.userId, requestBody.provider, request);
  }

  @Post("qr-login/session")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "创建扫码登录会话成功")
  @Middlewares(replayProtectionMiddleware)
  public async createQrLoginSession(@Request() request: ExpressRequest): Promise<CreateQrLoginSessionResponse> {
    return this.externalAuthService.createQrLoginSession(request);
  }

  @Post("qr-login/scan")
  @Security("jwt")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "扫码登录会话已标记")
  @Middlewares(replayProtectionMiddleware, validateBody(scanQrLoginBodySchema))
  public async scanQrLogin(
    @Body() requestBody: ScanQrLoginDto,
    @Request() request: TypedRequest,
  ): Promise<QrLoginSessionStatusResponse> {
    return this.externalAuthService.markQrSessionScanned(requestBody.sessionId, request.user!.userId, request);
  }

  @Post("qr-login/confirm")
  @Security("jwt")
  @ReplayProtected()
  @SuccessResponse(HttpStatusCode.Ok, "扫码登录确认成功")
  @Middlewares(replayProtectionMiddleware, validateBody(confirmQrLoginBodySchema))
  public async confirmQrLogin(
    @Body() requestBody: ConfirmQrLoginDto,
    @Request() request: TypedRequest,
  ): Promise<QrLoginSessionStatusResponse> {
    return this.externalAuthService.confirmQrLogin(
      requestBody.sessionId,
      requestBody.approve,
      request.user!.userId,
      request,
    );
  }

  @Get("qr-login/status")
  @SuccessResponse(HttpStatusCode.Ok, "获取扫码登录状态成功")
  @Middlewares(validateQuery(qrLoginStatusQuerySchema))
  public async getQrLoginStatus(
    @Query() sessionId: string,
    @Request() request: ExpressRequest,
  ): Promise<QrLoginSessionStatusResponse> {
    return this.externalAuthService.getQrLoginStatus(sessionId, request);
  }

  @Get("qr-login/stream")
  @SuccessResponse(HttpStatusCode.Ok, "扫码登录状态流建立成功")
  @Middlewares(validateQuery(qrLoginStatusQuerySchema))
  public async streamQrLoginStatus(@Query() sessionId: string, @Request() request: TypedRequest): Promise<void> {
    skipResponseWrapper(request);
    if (!request.res) throw new Error("Missing response object for QR stream");
    await this.externalAuthService.streamQrLoginStatus(sessionId, request, request.res);
  }

  @Post("qr-login/consume")
  @SuccessResponse(HttpStatusCode.Ok, "扫码登录会话已消费")
  @Middlewares(validateBody(scanQrLoginBodySchema))
  public async consumeQrLogin(
    @Body() requestBody: ScanQrLoginDto,
    @Request() request: ExpressRequest,
  ): Promise<QrLoginSessionStatusResponse> {
    return this.externalAuthService.consumeQrLoginSession(requestBody.sessionId, request);
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
  @Middlewares(
    replayProtectionMiddleware,
    validateBody(verifyTwoFactorLoginBodySchema),
    verifyTwoFactorRateLimitMiddleware,
  )
  public async verifyTwoFactorLogin(
    @Body() requestBody: VerifyTwoFactorLoginDto,
    @Request() request: ExpressRequest,
  ): Promise<VerifyTwoFactorLoginResponse> {
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
    twoFactorEmailSendRateLimitMiddleware,
  )
  public async sendTwoFactorEmailCode(
    @Body() requestBody: SendTwoFactorEmailCodeDto,
    @Request() request: ExpressRequest,
  ): Promise<SendTwoFactorEmailCodeResponse> {
    const clientIp = extractClientIp(request);

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
    emailVerificationRateLimitMiddleware,
  )
  public async sendRegisterVerificationCode(
    @Body() requestBody: SendRegisterVerificationCodeDto,
    @Request() request: ExpressRequest,
  ): Promise<SendRegisterVerificationCodeResponse> {
    await this.authService.sendVerificationCode(requestBody.email);

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
    passwordResetCodeRateLimitMiddleware,
  )
  public async sendPasswordResetCode(
    @Body() requestBody: SendPasswordResetCodeDto,
    @Request() request: ExpressRequest,
  ): Promise<SendPasswordResetCodeResponse> {
    await this.authService.sendPasswordResetCode(requestBody.username, requestBody.email);

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
