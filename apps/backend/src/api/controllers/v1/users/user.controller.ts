import {
  Get,
  Path,
  Route,
  Security,
  SuccessResponse,
  Response,
  Tags,
  Controller,
  Request,
  Post,
  Body,
  Put,
  Delete,
  Patch,
  Query,
  Middlewares,
} from "@tsoa/runtime";
import Express from "express";
import { UserService } from "@/services/users/user.service";
import { HttpStatusCode } from "axios";
import type {
  ChangePasswordDTO,
  CreateUserDto,
  UpdateUserDto,
  UpdateProfileDto,
  SendEmailChangeCodeDto,
  ChangeEmailDto,
  GetAllUsersResponse,
  GetUserByIdResponse,
  CreateUserResponse,
  UpdateUserResponse,
  UpdateProfileResponse,
  ChangeEmailResponse,
  SendEmailChangeCodeResponse,
} from "@/api/dto/users/user.dto";
import type {
  ConfirmTwoFactorSetupDto,
  ConfirmTwoFactorSetupResponse,
  DisableTwoFactorDto,
  DisableTwoFactorResponse,
  RegenerateTwoFactorRecoveryCodesDto,
  RegenerateTwoFactorRecoveryCodesResponse,
  TwoFactorSetupResponse,
  TwoFactorStatusResponse,
  UpdateTwoFactorPasskeyPolicyDto,
  UpdateTwoFactorPasskeyPolicyResponse,
  TwoFactorTrustClearResponse,
  TwoFactorTrustedDevicesResponse,
  DeleteTwoFactorTrustedDeviceResponse,
} from "@/api/dto/users/two-factor.dto";
import { Permission } from "@/constant/permission";
import { NotFoundError, ForbiddenError, BadRequestError, TooManyRequestsError } from "@/util/errors";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { permissionService } from "@/services/users/permission.service";
import { hashPassword } from "@/util/crypto";
import type { ErrorResponse } from "@/api/response";
import {
  changeEmailBodySchema,
  changePasswordBodySchema,
  createUserBodySchema,
  sendEmailChangeCodeBodySchema,
  updateProfileBodySchema,
  updateUserBodySchema,
  userIdParamsSchema,
  userListQuerySchema,
} from "@/api/schema/users/user.schema";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import {
  confirmTwoFactorSetupBodySchema,
  disableTwoFactorBodySchema,
  regenerateTwoFactorRecoveryCodesBodySchema,
  twoFactorTrustedDeviceParamsSchema,
  twoFactorTrustedDevicesQuerySchema,
  updateTwoFactorPasskeyPolicyBodySchema,
} from "@/api/schema/users/two-factor.schema";
import { TwoFactorService } from "@/services/auth/two-factor.service";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { extractClientIp } from "@/util/ip-extractor";
import { extractClientFingerprint } from "@/util/client-fingerprint";
import {
  clearTrustedDeviceTokenCookie,
  extractTrustedDeviceIdFromToken,
  extractTrustedDeviceToken,
} from "@/util/trusted-device-token";
import { EnvSpace } from "@/config/env";
import { TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_DEFAULT } from "@/constant/two-factor";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { RateLimiterService } from "@/services/infrastructure/rate-limiter.service";
import { CaptchaService as _CaptchaService } from "@/services/auth/captcha.service";
import { CaptchaProtected, captchaMiddleware } from "@/util/captcha-protected-decorator";
import { setResponseMessageKey } from "@/util/response-wrapper";

const _logger = getLogger("UserController", LogCategory.BUSINESS);

/**
 * 用户管理相关接口
 */
@Route("v1/users")
@Tags("User")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class UserController extends Controller {
  private userService = new UserService();
  private permissionService = permissionService;
  private twoFactorService = TwoFactorService.getInstance();
  private businessLogService = BusinessLogService.getInstance();
  private rateLimiterService = RateLimiterService.getInstance();

  private getUserAgent(userAgent: string | string[] | undefined): string {
    if (Array.isArray(userAgent)) return userAgent[0] || "";
    return userAgent || "";
  }

  private getRequestId(request: TypedRequest): string | undefined {
    const requestId = request.headers["x-request-id"];
    if (Array.isArray(requestId)) return requestId[0];
    if (typeof requestId === "string") return requestId;
    return undefined;
  }

  private getTrustedDeviceRateLimitMessage(reason?: string): {
    key: "user.trustedDeviceRateLimitIp" | "user.trustedDeviceRateLimitUser" | "errors.tooManyRequests";
    message: string;
  } {
    switch (reason) {
      case "TWO_FACTOR_TRUSTED_DEVICE_IP_RATE_LIMIT_EXCEEDED":
        return { key: "user.trustedDeviceRateLimitIp", message: "可信设备操作过于频繁，请稍后再试" };
      case "TWO_FACTOR_TRUSTED_DEVICE_USER_RATE_LIMIT_EXCEEDED":
        return {
          key: "user.trustedDeviceRateLimitUser",
          message: "当前账号可信设备操作过于频繁，请稍后再试",
        };
      default:
        return { key: "errors.tooManyRequests", message: "请求过于频繁，请稍后再试" };
    }
  }

  /**
   * 清理当前用户可信窗口（用于 2FA 测试）
   * @summary 清理 2FA trusted window
   */
  @Delete("me/2fa/trusted-window")
  @Security("jwt", ["two_factor"])
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(replayProtectionMiddleware)
  public async clearTwoFactorTrustedWindow(@Request() request: TypedRequest): Promise<TwoFactorTrustClearResponse> {
    if (!EnvSpace.isDevelopment) throw new NotFoundError("接口不存在");

    const userId = request.user?.userId;
    if (!userId) throw new NotFoundError("用户信息不存在", undefined, { messageKey: "user.userInfoNotFound" });

    await this.twoFactorService.clearTrustedWithinWindow(userId, {
      ipAddress: extractClientIp(request),
      userAgent: this.getUserAgent(request.headers["user-agent"]),
      fingerprint: extractClientFingerprint(request),
      trustedDeviceToken: extractTrustedDeviceToken(request),
    });

    clearTrustedDeviceTokenCookie(request);

    setResponseMessageKey(request, "user.clearTrustedWindowSuccess");
    return { message: "2FA trusted window 已清理" };
  }

  /**
   * 获取当前用户可信设备（2FA/验证码窗口期）
   * @summary 获取 2FA trusted devices
   */
  @Get("me/2fa/trusted-devices")
  @Security("jwt", ["two_factor"])
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(validateQuery(twoFactorTrustedDevicesQuerySchema))
  public async getTwoFactorTrustedDevices(
    @Request() request: TypedRequest,
    @Query() page: number = 1,
    @Query() pageSize: number = TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_DEFAULT,
  ): Promise<TwoFactorTrustedDevicesResponse> {
    const userId = request.user?.userId;
    if (!userId) throw new NotFoundError("用户信息不存在", undefined, { messageKey: "user.userInfoNotFound" });

    const clientIp = extractClientIp(request);
    const rateLimitCheck = await this.rateLimiterService.checkTwoFactorTrustedDeviceOperationRateLimit(
      clientIp,
      userId,
    );
    if (!rateLimitCheck.allowed) {
      const message = this.getTrustedDeviceRateLimitMessage(rateLimitCheck.reason);
      throw new TooManyRequestsError(message.message, rateLimitCheck.retryAfter, undefined, {
        messageKey: message.key,
      });
    }

    await this.rateLimiterService.logTwoFactorTrustedDeviceOperationAttempt(clientIp, userId);

    const devices = await this.twoFactorService.listTrustedDevicesWithinWindow(userId);
    const total = devices.length;
    const start = (page - 1) * pageSize;
    const paginatedDevices = start < total ? devices.slice(start, start + pageSize) : [];

    return {
      devices: paginatedDevices,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    };
  }

  /**
   * 删除当前用户指定可信设备（2FA/验证码窗口期）
   * @summary 删除 2FA trusted device
   */
  @Delete("me/2fa/trusted-devices/{deviceId}")
  @Security("jwt", ["two_factor"])
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(replayProtectionMiddleware, validateParams(twoFactorTrustedDeviceParamsSchema))
  public async deleteTwoFactorTrustedDevice(
    @Path() deviceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeleteTwoFactorTrustedDeviceResponse> {
    const userId = request.user?.userId;
    if (!userId) throw new NotFoundError("用户信息不存在", undefined, { messageKey: "user.userInfoNotFound" });

    const clientIp = extractClientIp(request);
    const rateLimitCheck = await this.rateLimiterService.checkTwoFactorTrustedDeviceOperationRateLimit(
      clientIp,
      userId,
    );
    if (!rateLimitCheck.allowed) {
      const message = this.getTrustedDeviceRateLimitMessage(rateLimitCheck.reason);
      throw new TooManyRequestsError(message.message, rateLimitCheck.retryAfter, undefined, {
        messageKey: message.key,
      });
    }

    await this.rateLimiterService.logTwoFactorTrustedDeviceOperationAttempt(clientIp, userId);

    const normalizedDeviceId = deviceId.toLowerCase();
    const removed = await this.twoFactorService.removeTrustedDeviceWithinWindow(userId, deviceId);

    const trustedDeviceToken = extractTrustedDeviceToken(request);
    const currentDeviceId = extractTrustedDeviceIdFromToken(trustedDeviceToken);
    if (currentDeviceId && currentDeviceId === normalizedDeviceId) clearTrustedDeviceTokenCookie(request);

    await this.businessLogService.logOperation({
      operationType: OperationType.TWO_FACTOR_TRUSTED_DEVICE_DELETE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceType: "TWO_FACTOR_TRUSTED_DEVICE",
      targetResourceId: normalizedDeviceId,
      description: removed ? "用户删除可信设备成功" : "用户删除可信设备未命中（设备不存在或已过期）",
      success: true,
      metadata: {
        deviceId: normalizedDeviceId,
        removed,
      },
      ipAddress: clientIp,
      userAgent: this.getUserAgent(request.headers["user-agent"]),
      requestId: this.getRequestId(request),
    });

    setResponseMessageKey(request, removed ? "user.trustedDeviceDeleted" : "user.trustedDeviceMissing");
    return {
      removed,
      message: removed ? "可信设备已删除" : "可信设备不存在或已过期",
    };
  }

  /**
   * 获取所有用户
   * @summary 获取用户列表
   * @returns 用户列表和总数
   */
  @Get("")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.USER_READ)
  @Middlewares(validateQuery(userListQuerySchema))
  public async getAllUsers(
    @Request() request: TypedRequest,
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Query() keyword?: string,
    @Query() userId?: string,
    @Query() groupId?: string,
    @Query() excludeCurrentUser?: boolean,
    @Query() userType?: string,
    @Query() hasRamPermission?: boolean,
  ): Promise<GetAllUsersResponse> {
    return this.userService.getVisibleUsersPage({
      actorUserId: request.user!.userId,
      page,
      pageSize,
      keyword,
      userId,
      groupId,
      excludeCurrentUser,
      userType,
      hasRamPermission,
    });
  }

  /**
   * 获取当前登录用户信息
   * @summary 获取当前用户
   * @returns 当前用户信息
   */
  @Get("me")
  @Security("jwt", ["profile"])
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  public async getCurrentUser(@Request() request: TypedRequest): Promise<GetUserByIdResponse> {
    // 从 token 中获取当前用户 ID
    const userId = request.user?.userId;

    if (!userId) throw new NotFoundError("用户信息不存在", undefined, { messageKey: "user.userInfoNotFound" });

    const user = await this.userService.getUserById(userId);

    if (!user) throw new NotFoundError("用户不存在", undefined, { messageKey: "user.notFound" });

    return user;
  }

  /**
   * 更新当前用户的个人资料（姓名）
   * @summary 更新个人资料
   */
  @Patch("me/profile")
  @Security("jwt", ["profile"])
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "请求参数错误")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.USER_UPDATE_SELF_PROFILE)
  @Middlewares(replayProtectionMiddleware, validateBody(updateProfileBodySchema))
  public async updateProfile(
    @Body() body: UpdateProfileDto,
    @Request() request: TypedRequest,
  ): Promise<UpdateProfileResponse> {
    const userId = request.user?.userId;
    if (!userId) throw new NotFoundError("用户信息不存在", undefined, { messageKey: "user.userInfoNotFound" });
    return this.userService.updateProfile(userId, body, request);
  }

  /**
   * 发送邮箱变更验证码到新邮箱
   * @summary 发送邮箱变更验证码
   */
  @Post("me/send-email-change-code")
  @Security("jwt", ["email"])
  @SuccessResponse(HttpStatusCode.Ok, "验证码已发送")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "请求参数错误")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.USER_UPDATE_SELF_EMAIL)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @CaptchaProtected({ action: "change_email", trustOnly: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(sendEmailChangeCodeBodySchema),
    captchaMiddleware({ action: "change_email", trustOnly: true }),
  )
  public async sendEmailChangeCode(
    @Body() body: SendEmailChangeCodeDto,
    @Request() request: TypedRequest,
  ): Promise<SendEmailChangeCodeResponse> {
    const userId = request.user?.userId;
    if (!userId) throw new NotFoundError("用户信息不存在", undefined, { messageKey: "user.userInfoNotFound" });

    await this.userService.sendEmailChangeCode(userId, body.newEmail, request);
    setResponseMessageKey(request, "user.emailChangeCodeSent");
    return { message: "验证码已发送" };
  }

  /**
   * 通过验证码修改邮箱
   * @summary 修改邮箱
   */
  @Patch("me/email")
  @Security("jwt", ["email"])
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "请求参数错误")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.USER_UPDATE_SELF_EMAIL)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(changeEmailBodySchema),
  )
  public async changeEmail(
    @Body() body: ChangeEmailDto,
    @Request() request: TypedRequest,
  ): Promise<ChangeEmailResponse> {
    const userId = request.user?.userId;
    if (!userId) throw new NotFoundError("用户信息不存在", undefined, { messageKey: "user.userInfoNotFound" });
    await this.userService.changeEmail(userId, body, request);
    setResponseMessageKey(request, "user.emailChanged");
    return { message: "邮箱修改成功" };
  }

  /**
   * 获取当前用户 2FA 状态
   * @summary 获取 2FA 设置状态
   */
  @Get("me/2fa/status")
  @Security("jwt", ["two_factor"])
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async getTwoFactorStatus(@Request() request: TypedRequest): Promise<TwoFactorStatusResponse> {
    const userId = request.user?.userId;
    if (!userId) throw new NotFoundError("用户信息不存在", undefined, { messageKey: "user.userInfoNotFound" });

    return this.twoFactorService.getStatus(userId);
  }

  /**
   * 开始配置当前用户 2FA
   * @summary 生成 2FA 绑定二维码与会话
   */
  @Post("me/2fa/setup")
  @Security("jwt", ["two_factor"])
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(replayProtectionMiddleware)
  public async beginTwoFactorSetup(@Request() request: TypedRequest): Promise<TwoFactorSetupResponse> {
    const userId = request.user?.userId;
    if (!userId) throw new NotFoundError("用户信息不存在", undefined, { messageKey: "user.userInfoNotFound" });

    const response = await this.twoFactorService.beginSetup(userId);

    await this.businessLogService.logOperation({
      operationType: OperationType.TWO_FACTOR_SETUP_BEGIN,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      description: "用户开始配置二次验证",
      success: true,
      ipAddress: extractClientIp(request),
      userAgent: this.getUserAgent(request.headers["user-agent"]),
      requestId: this.getRequestId(request),
    });

    return response;
  }

  /**
   * 确认配置当前用户 2FA
   * @summary 校验动态码并启用 2FA
   */
  @Post("me/2fa/confirm")
  @Security("jwt", ["two_factor"])
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(replayProtectionMiddleware, validateBody(confirmTwoFactorSetupBodySchema))
  public async confirmTwoFactorSetup(
    @Body() body: ConfirmTwoFactorSetupDto,
    @Request() request: TypedRequest,
  ): Promise<ConfirmTwoFactorSetupResponse> {
    const userId = request.user?.userId;
    if (!userId) throw new NotFoundError("用户信息不存在", undefined, { messageKey: "user.userInfoNotFound" });

    const response = await this.twoFactorService.confirmSetup(userId, body.setupToken, body.code);

    await this.businessLogService.logOperation({
      operationType: OperationType.TWO_FACTOR_SETUP_CONFIRM,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      description: "用户完成二次验证配置并启用",
      success: true,
      metadata: {
        recoveryCodeCount: response.recoveryCodes.length,
      },
      ipAddress: extractClientIp(request),
      userAgent: this.getUserAgent(request.headers["user-agent"]),
      requestId: this.getRequestId(request),
    });

    return response;
  }

  /**
   * 关闭当前用户 2FA
   * @summary 使用动态码或恢复码关闭 2FA
   */
  @Post("me/2fa/disable")
  @Security("jwt", ["two_factor"])
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(replayProtectionMiddleware, validateBody(disableTwoFactorBodySchema))
  public async disableTwoFactor(
    @Body() body: DisableTwoFactorDto,
    @Request() request: TypedRequest,
  ): Promise<DisableTwoFactorResponse> {
    const userId = request.user?.userId;
    if (!userId) throw new NotFoundError("用户信息不存在", undefined, { messageKey: "user.userInfoNotFound" });

    const response = await this.twoFactorService.disable(userId, {
      code: body.code,
      recoveryCode: body.recoveryCode,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.TWO_FACTOR_DISABLE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      description: "用户关闭二次验证",
      success: true,
      ipAddress: extractClientIp(request),
      userAgent: this.getUserAgent(request.headers["user-agent"]),
      requestId: this.getRequestId(request),
    });

    return response;
  }

  /**
   * 重新生成当前用户恢复码
   * @summary 使用动态码或恢复码验证后，生成新的恢复码
   */
  @Post("me/2fa/recovery-codes/regenerate")
  @Security("jwt", ["two_factor"])
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(replayProtectionMiddleware, validateBody(regenerateTwoFactorRecoveryCodesBodySchema))
  public async regenerateTwoFactorRecoveryCodes(
    @Body() body: RegenerateTwoFactorRecoveryCodesDto,
    @Request() request: TypedRequest,
  ): Promise<RegenerateTwoFactorRecoveryCodesResponse> {
    const userId = request.user?.userId;
    if (!userId) throw new NotFoundError("用户信息不存在");

    const response = await this.twoFactorService.regenerateRecoveryCodes(userId, {
      code: body.code,
      recoveryCode: body.recoveryCode,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.TWO_FACTOR_RECOVERY_CODES_REGENERATE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      description: "用户重新生成二次验证恢复码",
      success: true,
      metadata: {
        recoveryCodeCount: response.recoveryCodes.length,
      },
      ipAddress: extractClientIp(request),
      userAgent: this.getUserAgent(request.headers["user-agent"]),
      requestId: this.getRequestId(request),
    });

    return response;
  }

  /**
   * 更新 passkey 登录是否要求 2FA
   * @summary 设置 passkey 二次验证策略
   */
  @Patch("me/2fa/passkey-policy")
  @Security("jwt", ["two_factor"])
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(replayProtectionMiddleware, validateBody(updateTwoFactorPasskeyPolicyBodySchema))
  public async updateTwoFactorPasskeyPolicy(
    @Body() body: UpdateTwoFactorPasskeyPolicyDto,
    @Request() request: TypedRequest,
  ): Promise<UpdateTwoFactorPasskeyPolicyResponse> {
    const userId = request.user?.userId;
    if (!userId) throw new NotFoundError("用户信息不存在");

    const response = await this.twoFactorService.updatePasskeyPolicy(userId, body.passkeyRequired);

    await this.businessLogService.logOperation({
      operationType: OperationType.TWO_FACTOR_PASSKEY_POLICY_UPDATE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      description: "用户更新 passkey 二次验证策略",
      success: true,
      metadata: {
        passkeyRequired: body.passkeyRequired,
      },
      ipAddress: extractClientIp(request),
      userAgent: this.getUserAgent(request.headers["user-agent"]),
      requestId: this.getRequestId(request),
    });

    return response;
  }

  /**
   * 根据ID获取用户
   * @summary 获取用户详情
   * @param userId 用户ID
   * @returns 用户详情
   * @example userId "123456"
   */
  @Get("{userId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "用户不存在")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.USER_READ)
  @Middlewares(validateParams(userIdParamsSchema))
  public async getUserById(@Request() request: Express.Request, @Path() userId: string): Promise<GetUserByIdResponse> {
    const user = await this.userService.getUserById(userId);

    if (!user) throw new NotFoundError("用户不存在", undefined, { messageKey: "user.notFound" });

    return user;
  }

  /**
   * 创建用户
   * @summary 创建新用户
   */
  @Post("create")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Created, "Created")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "请求参数错误")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.USER_CREATE)
  @Middlewares(replayProtectionMiddleware, validateBody(createUserBodySchema))
  public async createUser(@Body() body: CreateUserDto, @Request() request: TypedRequest): Promise<CreateUserResponse> {
    const hashedPassword = hashPassword(body.password);
    const user = await this.userService.createUser(
      { ...body, password: hashedPassword },
      request.user!.userId,
      request,
    );
    this.setStatus(HttpStatusCode.Created);
    return user;
  }

  /**
   * 更新用户信息
   * @summary 更新用户
   * @param userId 用户ID
   */
  @Put("{userId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "请求参数错误")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "用户不存在")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.USER_UPDATE)
  @Middlewares(replayProtectionMiddleware, validateParams(userIdParamsSchema), validateBody(updateUserBodySchema))
  public async updateUser(
    @Body() body: UpdateUserDto,
    @Request() request: TypedRequest,
    @Path() userId: string,
  ): Promise<UpdateUserResponse> {
    const currentUserId = request.user!.userId;
    // Level check: cannot modify users at same or higher level (except self)
    if (userId !== currentUserId) {
      const [actorLevel, targetLevel] = await Promise.all([
        this.userService.getUserGroupLevel(currentUserId),
        this.userService.getUserGroupLevel(userId),
      ]);
      if (actorLevel == null || targetLevel == null)
        throw new NotFoundError("用户不存在", undefined, { messageKey: "user.notFound" });
      if (targetLevel <= actorLevel)
        throw new ForbiddenError("不能修改同级或更高级别的用户", undefined, { messageKey: "user.cannotModifyPeer" });
    }
    return this.userService.updateUser(userId, body, currentUserId, request);
  }

  /**
   * 删除用户（软删除）
   * @summary 删除用户
   * @param userId 用户ID
   */
  @Delete("{userId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "请求参数错误")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "用户不存在")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.USER_DELETE)
  @Middlewares(replayProtectionMiddleware, validateParams(userIdParamsSchema))
  public async deleteUser(@Request() request: TypedRequest, @Path() userId: string): Promise<{ message: string }> {
    const currentUserId = request.user!.userId;
    if (userId === currentUserId)
      throw new BadRequestError("不能删除自己", undefined, { messageKey: "user.cannotDeleteSelf" });
    // Level check
    const [actorLevel, targetLevel] = await Promise.all([
      this.userService.getUserGroupLevel(currentUserId),
      this.userService.getUserGroupLevel(userId),
    ]);
    if (actorLevel == null || targetLevel == null)
      throw new NotFoundError("用户不存在", undefined, { messageKey: "user.notFound" });
    if (targetLevel <= actorLevel)
      throw new ForbiddenError("不能删除同级或更高级别的用户", undefined, { messageKey: "user.cannotDeletePeer" });

    await this.userService.deleteUser(userId, currentUserId, request);
    setResponseMessageKey(request, "user.deleted");
    return { message: "删除成功" };
  }

  @Patch("{userId}/password")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(userIdParamsSchema),
    validateBody(changePasswordBodySchema),
  )
  public async changePassword(
    @Body() body: ChangePasswordDTO,
    @Request() request: TypedRequest,
    @Path() userId: string,
  ): Promise<{ message: string }> {
    const currentUserId = request.user?.userId;
    // 为空则修改当前用户密码
    const tarUserId = userId ?? currentUserId;
    const isChangeSelf = userId === currentUserId;

    if (!userId) throw new NotFoundError("用户信息不存在", undefined, { messageKey: "user.userInfoNotFound" });

    // 获取用户的有效权限
    const userPermissions = await this.permissionService.getUserFullPermissions(currentUserId!);
    if (!userPermissions) throw new ForbiddenError("权限不足");

    const effectivePermissionsSet = new Set(userPermissions.effectivePermissions);
    const hasChangeOthersPermission = effectivePermissionsSet.has(Permission.USER_CHANGE_OTHERS_PASSWORD);
    const hasChangeSelfPermission = effectivePermissionsSet.has(Permission.USER_CHANGE_SELF_PASSWORD);

    if (isChangeSelf && !hasChangeSelfPermission) throw new ForbiddenError("权限不足");
    if (!isChangeSelf && !hasChangeOthersPermission) throw new ForbiddenError("权限不足");
    if ((await this.userService.getUserById(tarUserId)) === null)
      throw new NotFoundError("用户不存在", undefined, { messageKey: "user.notFound" });

    await this.userService.changeUserPassword(tarUserId, hashPassword(body.newPassword), currentUserId, request);

    setResponseMessageKey(request, "user.passwordChanged");
    return {
      message: "密码修改成功",
    };
  }
}
