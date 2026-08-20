import {
  Body,
  Get,
  Route,
  Security,
  SuccessResponse,
  Response,
  Tags,
  Controller,
  Request,
  Put,
  Middlewares,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { ConfigService } from "@/services/system/config.service";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type {
  BillingConfigDto,
  CaptchaConfigDto,
  HeartbeatConfigDto,
  RemoteTerminalUnbindConfigDto,
  SetConfigDto,
  GetConfigResponse,
  NotificationConfigDto,
  PublicCaptchaConfigDto,
  PublicSocialAuthConfigDto,
  RegistrationStatusResponse,
  SetBillingConfigDto,
  SetCaptchaConfigDto,
  SetHeartbeatConfigDto,
  SetRemoteTerminalUnbindConfigDto,
  SetNotificationConfigDto,
  SetRegistrationConfigDto,
  SetRelayConfigDto,
  SetSocialAuthConfigDto,
  SetSmtpConfigDto,
  SetSiteConfigDto,
  SetIpBanConfigDto,
  SiteConfigDto,
  SocialAuthConfigDto,
  RelayProxyConfigDto,
  SetRelayProxyConfigDto,
} from "@/api/dto/system/config.dto";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { ErrorResponse } from "@/api/response";
import {
  setConfigBodySchema,
  setBillingConfigBodySchema,
  setCaptchaConfigBodySchema,
  setHeartbeatConfigBodySchema,
  setRemoteTerminalUnbindConfigBodySchema,
  setNotificationConfigBodySchema,
  setIpBanConfigBodySchema,
  setRegistrationConfigBodySchema,
  setRelayConfigBodySchema,
  setSocialAuthConfigBodySchema,
  setSmtpConfigBodySchema,
  setSiteConfigBodySchema,
  setRelayProxyConfigBodySchema,
} from "@/api/schema/system/config.schema";
import { validateBody } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { setResponseMessageKey } from "@/util/response-wrapper";

const logger = getLogger("ConfigController", LogCategory.SYSTEM);

@Route("v1/config")
@Tags("Server Configuration")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class ConfigController extends Controller {
  private configService = ConfigService.getInstance();

  @Get("")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async getAllConfigs(@Request() _request: TypedRequest): Promise<GetConfigResponse> {
    const configs = await this.configService.getAllConfigs();
    return { configs };
  }

  @Put("")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "设置失败")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(setConfigBodySchema),
  )
  public async setConfigs(@Body() body: SetConfigDto, @Request() request: TypedRequest): Promise<{ message: string }> {
    const currentUserId = request.user!.userId;
    await this.configService.setMultiple(body.configs, currentUserId, request);
    logger.info("服务器配置已更新");
    setResponseMessageKey(request, "system.configUpdated");
    return { message: "配置更新成功" };
  }

  @Get("public/registration")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async getRegistrationStatus(): Promise<RegistrationStatusResponse> {
    const config = await this.configService.getRegistrationConfig();
    return { enabled: config.enabled };
  }

  @Get("public/captcha")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async getPublicCaptchaConfig(): Promise<PublicCaptchaConfigDto> {
    const config = await this.configService.getCaptchaConfig();
    return {
      enabled: config.enabled,
      provider: config.provider,
      fallbackProvider: config.fallbackProvider,
    };
  }

  @Get("public/social-auth")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async getPublicSocialAuthConfig(): Promise<PublicSocialAuthConfigDto> {
    return await this.configService.getPublicSocialAuthConfig();
  }

  @Get("registration")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  public async getRegistrationConfig(@Request() _request: TypedRequest) {
    return await this.configService.getRegistrationConfig();
  }

  @Get("relay")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  public async getRelayConfig(@Request() _request: TypedRequest) {
    return await this.configService.getRelayConfig();
  }

  @Get("relay/proxy")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  public async getRelayProxyConfig(@Request() _request: TypedRequest): Promise<RelayProxyConfigDto> {
    return await this.configService.getRelayProxyConfig();
  }

  @Get("smtp")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  public async getSmtpConfig(@Request() _request: TypedRequest) {
    return await this.configService.getSmtpConfig();
  }

  @Get("site")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  public async getSiteConfig(@Request() _request: TypedRequest): Promise<SiteConfigDto> {
    return await this.configService.getSiteConfig();
  }

  @Get("notification")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  public async getNotificationConfig(@Request() _request: TypedRequest): Promise<NotificationConfigDto> {
    return await this.configService.getNotificationConfig();
  }

  @Get("ipban")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  public async getIpBanConfig(@Request() _request: TypedRequest) {
    return await this.configService.getIpBanConfig();
  }

  @Get("billing")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  public async getBillingConfig(@Request() _request: TypedRequest): Promise<BillingConfigDto> {
    return await this.configService.getBillingConfig();
  }

  @Get("heartbeat")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  public async getHeartbeatConfig(@Request() _request: TypedRequest): Promise<HeartbeatConfigDto> {
    return await this.configService.getHeartbeatConfig();
  }

  @Get("remote-terminal/unbind")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  public async getRemoteTerminalUnbindConfig(
    @Request() _request: TypedRequest,
  ): Promise<RemoteTerminalUnbindConfigDto> {
    return await this.configService.getRemoteTerminalUnbindConfig();
  }

  @Get("captcha")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  public async getCaptchaConfig(@Request() _request: TypedRequest): Promise<CaptchaConfigDto> {
    return await this.configService.getCaptchaConfig();
  }

  @Get("social-auth")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  public async getSocialAuthConfig(@Request() _request: TypedRequest): Promise<SocialAuthConfigDto> {
    return await this.configService.getSocialAuthConfig();
  }

  @Put("registration")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(setRegistrationConfigBodySchema),
  )
  public async setRegistrationConfig(@Body() body: SetRegistrationConfigDto, @Request() request: TypedRequest) {
    const currentUserId = request.user!.userId;
    await this.configService.setMultiple(
      {
        [CONFIG_KEYS.REGISTRATION.ENABLED]: String(body.enabled),
        [CONFIG_KEYS.REGISTRATION.MAX_ACCOUNTS_PER_EMAIL]: String(body.maxAccountsPerEmail),
        [CONFIG_KEYS.REGISTRATION.DEFAULT_GROUP_USERNAME]: body.defaultGroupUsername,
        [CONFIG_KEYS.REGISTRATION.VERIFICATION_CODE_EXPIRY]: String(body.verificationCodeExpiry),
      },
      currentUserId,
      request,
    );
    setResponseMessageKey(request, "system.configUpdated");
    return { message: "配置更新成功" };
  }

  @Put("relay")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(setRelayConfigBodySchema),
  )
  public async setRelayConfig(@Body() body: SetRelayConfigDto, @Request() request: TypedRequest) {
    const currentUserId = request.user!.userId;
    await this.configService.setMultiple(
      {
        [CONFIG_KEYS.RELAY.UPSTREAM_URL]: body.upstreamUrl,
        [CONFIG_KEYS.RELAY.UPSTREAM_API_KEY]: body.upstreamApiKey,
        [CONFIG_KEYS.RELAY.ALLOWED_MODELS]: body.allowedModels,
        [CONFIG_KEYS.RELAY.CUSTOM_KEY_ENABLED]: String(body.customKeyEnabled),
        [CONFIG_KEYS.RELAY.CUSTOM_KEY_MAX_TOKENS_PER_USER]: String(body.customKeyMaxTokensPerUser),
        [CONFIG_KEYS.RELAY.CUSTOM_KEY_CREATE_LIMIT_WINDOW_MINUTES]: String(body.customKeyCreateLimitWindowMinutes),
        [CONFIG_KEYS.RELAY.CUSTOM_KEY_CREATE_LIMIT_MAX_COUNT]: String(body.customKeyCreateLimitMaxCount),
      },
      currentUserId,
      request,
    );
    setResponseMessageKey(request, "system.configUpdated");
    return { message: "配置更新成功" };
  }

  @Put("relay/proxy")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(setRelayProxyConfigBodySchema),
  )
  public async setRelayProxyConfig(@Body() body: SetRelayProxyConfigDto, @Request() request: TypedRequest) {
    const currentUserId = request.user!.userId;
    await this.configService.setMultiple(
      {
        [CONFIG_KEYS.RELAY.UPSTREAM_PROXY_ENABLED]: String(body.enabled),
        [CONFIG_KEYS.RELAY.UPSTREAM_PROXY_URL]: body.url,
      },
      currentUserId,
      request,
    );
    setResponseMessageKey(request, "system.configUpdated");
    return { message: "配置更新成功" };
  }

  @Put("smtp")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(setSmtpConfigBodySchema),
  )
  public async setSmtpConfig(@Body() body: SetSmtpConfigDto, @Request() request: TypedRequest) {
    const currentUserId = request.user!.userId;
    await this.configService.setMultiple(
      {
        [CONFIG_KEYS.SMTP.HOST]: body.host,
        [CONFIG_KEYS.SMTP.PORT]: String(body.port),
        [CONFIG_KEYS.SMTP.SECURE]: String(body.secure),
        [CONFIG_KEYS.SMTP.USER]: body.user,
        [CONFIG_KEYS.SMTP.PASSWORD]: body.password,
        [CONFIG_KEYS.SMTP.SENDER_NAME]: body.senderName,
        [CONFIG_KEYS.SMTP.SENDER_EMAIL]: body.senderEmail,
      },
      currentUserId,
      request,
    );
    setResponseMessageKey(request, "system.configUpdated");
    return { message: "配置更新成功" };
  }

  @Put("site")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(setSiteConfigBodySchema),
  )
  public async setSiteConfig(@Body() body: SetSiteConfigDto, @Request() request: TypedRequest) {
    const currentUserId = request.user!.userId;
    await this.configService.setMultiple(
      {
        [CONFIG_KEYS.SITE.BACKEND_PUBLIC_URL]: body.backendPublicUrl,
      },
      currentUserId,
      request,
    );
    setResponseMessageKey(request, "system.configUpdated");
    return { message: "配置更新成功" };
  }

  @Put("notification")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(setNotificationConfigBodySchema),
  )
  public async setNotificationConfig(@Body() body: SetNotificationConfigDto, @Request() request: TypedRequest) {
    const currentUserId = request.user!.userId;
    await this.configService.setMultiple(
      {
        [CONFIG_KEYS.NOTIFICATION.DEFAULT_SUBSCRIBED_EVENTS]: JSON.stringify(body.defaultSubscribedEvents),
        [CONFIG_KEYS.NOTIFICATION.DEFAULT_THRESHOLDS]: JSON.stringify(body.defaultThresholds),
        [CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES]: JSON.stringify(body.ticketAssignmentRules),
      },
      currentUserId,
      request,
    );
    setResponseMessageKey(request, "system.configUpdated");
    return { message: "配置更新成功" };
  }

  @Put("ipban")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(setIpBanConfigBodySchema),
  )
  public async setIpBanConfig(@Body() body: SetIpBanConfigDto, @Request() request: TypedRequest) {
    const currentUserId = request.user!.userId;
    await this.configService.setMultiple(
      {
        [CONFIG_KEYS.IP_BAN.ENABLED]: String(body.enabled),
        [CONFIG_KEYS.IP_BAN.LEVEL_1_THRESHOLD]: String(body.level1Threshold),
        [CONFIG_KEYS.IP_BAN.LEVEL_1_DURATION]: String(body.level1Duration),
        [CONFIG_KEYS.IP_BAN.LEVEL_2_THRESHOLD]: String(body.level2Threshold),
        [CONFIG_KEYS.IP_BAN.LEVEL_2_DURATION]: String(body.level2Duration),
        [CONFIG_KEYS.IP_BAN.LEVEL_3_THRESHOLD]: String(body.level3Threshold),
        [CONFIG_KEYS.IP_BAN.LEVEL_3_DURATION]: String(body.level3Duration),
      },
      currentUserId,
      request,
    );
    setResponseMessageKey(request, "system.configUpdated");
    return { message: "配置更新成功" };
  }

  @Put("billing")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(setBillingConfigBodySchema),
  )
  public async setBillingConfig(@Body() body: SetBillingConfigDto, @Request() request: TypedRequest) {
    const currentUserId = request.user!.userId;
    await this.configService.setMultiple(
      {
        [CONFIG_KEYS.BILLING.RECHARGE_RATIO]: String(body.rechargeRatio),
        [CONFIG_KEYS.BILLING.GIFT_CODE_ENABLED]: String(body.giftCodeEnabled),
        [CONFIG_KEYS.BILLING.DIRECT_TRANSFER_ENABLED]: String(body.directTransferEnabled),
        [CONFIG_KEYS.BILLING.GIFT_CODE_FEE_PERCENT]: String(body.giftCodeFeePercent),
        [CONFIG_KEYS.BILLING.DIRECT_TRANSFER_FEE_PERCENT]: String(body.directTransferFeePercent),
        [CONFIG_KEYS.BILLING.GIFT_CODE_CANCEL_FEE_REFUND_PERCENT]: String(body.giftCodeCancelFeeRefundPercent),
      },
      currentUserId,
      request,
    );
    setResponseMessageKey(request, "system.configUpdated");
    return { message: "配置更新成功" };
  }

  @Put("heartbeat")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(setHeartbeatConfigBodySchema),
  )
  public async setHeartbeatConfig(@Body() body: SetHeartbeatConfigDto, @Request() request: TypedRequest) {
    const currentUserId = request.user!.userId;
    await this.configService.setMultiple(
      {
        [CONFIG_KEYS.HEARTBEAT.INTERVAL_SECONDS]: String(body.intervalSeconds),
        [CONFIG_KEYS.HEARTBEAT.TIMEOUT_SECONDS]: String(body.timeoutSeconds),
      },
      currentUserId,
      request,
    );
    setResponseMessageKey(request, "system.configUpdated");
    return { message: "配置更新成功" };
  }

  @Put("remote-terminal/unbind")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(setRemoteTerminalUnbindConfigBodySchema),
  )
  public async setRemoteTerminalUnbindConfig(
    @Body() body: SetRemoteTerminalUnbindConfigDto,
    @Request() request: TypedRequest,
  ) {
    const currentUserId = request.user!.userId;
    await this.configService.setMultiple(
      {
        [CONFIG_KEYS.REMOTE_TERMINAL.UNBIND_MAX_COUNT]: String(body.maxCount),
        [CONFIG_KEYS.REMOTE_TERMINAL.UNBIND_WINDOW_HOURS]: String(body.windowHours),
        [CONFIG_KEYS.REMOTE_TERMINAL.REBIND_COOLDOWN_MINUTES]: String(body.rebindCooldownMinutes),
      },
      currentUserId,
      request,
    );
    setResponseMessageKey(request, "system.configUpdated");
    return { message: "配置更新成功" };
  }

  @Put("captcha")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(setCaptchaConfigBodySchema),
  )
  public async setCaptchaConfig(@Body() body: SetCaptchaConfigDto, @Request() request: TypedRequest) {
    const currentUserId = request.user!.userId;
    await this.configService.setMultiple(
      {
        [CONFIG_KEYS.CAPTCHA.PROVIDER]: body.provider,
        [CONFIG_KEYS.CAPTCHA.FALLBACK_PROVIDER]: body.fallbackProvider,
        [CONFIG_KEYS.CAPTCHA.MIN_SCORE]: String(body.minScore),
        [CONFIG_KEYS.CAPTCHA.TRUST_WINDOW_MINUTES]: String(body.trustWindowMinutes),
      },
      currentUserId,
      request,
    );
    setResponseMessageKey(request, "system.configUpdated");
    return { message: "配置更新成功" };
  }

  @Put("social-auth")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(setSocialAuthConfigBodySchema),
  )
  public async setSocialAuthConfig(@Body() body: SetSocialAuthConfigDto, @Request() request: TypedRequest) {
    const currentUserId = request.user!.userId;
    await this.configService.setMultiple(
      {
        [CONFIG_KEYS.SOCIAL_AUTH.FRONTEND_BASE_URL]: body.frontendBaseUrl,
        [CONFIG_KEYS.SOCIAL_AUTH.QR_LOGIN_ENABLED]: String(body.qrLoginEnabled),
        [CONFIG_KEYS.SOCIAL_AUTH.STATE_TTL_SECONDS]: String(body.stateTtlSeconds),
        [CONFIG_KEYS.SOCIAL_AUTH.QR_LOGIN_TTL_SECONDS]: String(body.qrLoginTtlSeconds),
        [CONFIG_KEYS.SOCIAL_AUTH.QR_LOGIN_POLL_INTERVAL_SECONDS]: String(body.qrLoginPollIntervalSeconds),
        [CONFIG_KEYS.SOCIAL_AUTH.GITHUB.ENABLED]: String(body.github.enabled),
        [CONFIG_KEYS.SOCIAL_AUTH.GITHUB.CLIENT_ID]: body.github.clientId,
        [CONFIG_KEYS.SOCIAL_AUTH.GITHUB.CLIENT_SECRET]: body.github.clientSecret,
        [CONFIG_KEYS.SOCIAL_AUTH.GITHUB.AUTHORIZE_URL]: body.github.authorizeUrl,
        [CONFIG_KEYS.SOCIAL_AUTH.GITHUB.TOKEN_URL]: body.github.tokenUrl,
        [CONFIG_KEYS.SOCIAL_AUTH.GITHUB.USER_URL]: body.github.userUrl,
        [CONFIG_KEYS.SOCIAL_AUTH.GITHUB.EMAIL_URL]: body.github.emailUrl,
        [CONFIG_KEYS.SOCIAL_AUTH.GITHUB.SCOPE]: body.github.scope,
        [CONFIG_KEYS.SOCIAL_AUTH.GITHUB.CALLBACK_PATH]: body.github.callbackPath,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_OPEN.ENABLED]: String(body.wechatOpen.enabled),
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_OPEN.APP_ID]: body.wechatOpen.appId,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_OPEN.APP_SECRET]: body.wechatOpen.appSecret,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_OPEN.AUTHORIZE_URL]: body.wechatOpen.authorizeUrl,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_OPEN.TOKEN_URL]: body.wechatOpen.tokenUrl,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_OPEN.USER_URL]: body.wechatOpen.userUrl,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_OPEN.SCOPE]: body.wechatOpen.scope,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_OPEN.CALLBACK_PATH]: body.wechatOpen.callbackPath,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_WEB.ENABLED]: String(body.wechatWeb.enabled),
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_WEB.APP_ID]: body.wechatWeb.appId,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_WEB.APP_SECRET]: body.wechatWeb.appSecret,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_WEB.AUTHORIZE_URL]: body.wechatWeb.authorizeUrl,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_WEB.TOKEN_URL]: body.wechatWeb.tokenUrl,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_WEB.USER_URL]: body.wechatWeb.userUrl,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_WEB.SCOPE]: body.wechatWeb.scope,
        [CONFIG_KEYS.SOCIAL_AUTH.WECHAT_WEB.CALLBACK_PATH]: body.wechatWeb.callbackPath,
      },
      currentUserId,
      request,
    );
    setResponseMessageKey(request, "system.configUpdated");
    return { message: "配置更新成功" };
  }
}
