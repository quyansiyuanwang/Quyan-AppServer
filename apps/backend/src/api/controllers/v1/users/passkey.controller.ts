import {
  Body,
  Controller,
  Delete,
  Get,
  Path,
  Post,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
  Middlewares,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { PasskeyService } from "@/services/auth/passkey.service";
import { AuthService } from "@/services/auth/auth.service";
import { UnauthorizedError } from "@/util/errors";
import { UserRepository } from "@/store/users/user.repository";
import { TwoFactorService } from "@/services/auth/two-factor.service";
import { validateAccountStatus } from "@/util/auth/account-status";
import type {
  PasskeyRegistrationOptionsResponse,
  PasskeyRegistrationVerifyRequest,
  PasskeyRegistrationVerifyResponse,
  PasskeyAuthOptionsResponse,
  PasskeyAuthVerifyRequest,
  PasskeyAuthVerifyResponse,
  PasskeyListResponse,
  DeletePasskeyResponse,
} from "@/api/dto/users/passkey.dto";
import type { TypedRequest } from "@/types/express";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import {
  passkeyAuthVerifyBodySchema,
  passkeyCredentialIdParamsSchema,
  passkeyRegistrationVerifyBodySchema,
} from "@/api/schema/users/passkey.schema";
import { validateBody, validateParams } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { extractClientIp } from "@/util/ip-extractor";
import { extractClientFingerprint } from "@/util/client-fingerprint";
import { extractTrustedDeviceToken } from "@/util/trusted-device-token";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";

@Route("v1/passkey")
@Tags("Passkey")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class PasskeyController extends Controller {
  private passkeyService = PasskeyService.getInstance();
  private userRepository = UserRepository.getInstance();
  private twoFactorService = TwoFactorService.getInstance();
  private businessLogService = BusinessLogService.getInstance();
  private authService = new AuthService();

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

  @Post("register/options")
  @Security("jwt")
  @RequirePermission(Permission.PASSKEY_MANAGE)
  @SuccessResponse(HttpStatusCode.Ok, "生成注册选项成功")
  public async getRegistrationOptions(@Request() request: TypedRequest): Promise<PasskeyRegistrationOptionsResponse> {
    const userId = request.user!.userId;
    const options = await this.passkeyService.generateRegistrationOptions(userId);
    return { options: options };
  }

  @Post("register/verify")
  @Security("jwt")
  @RequirePermission(Permission.PASSKEY_MANAGE)
  @SuccessResponse(HttpStatusCode.Ok, "注册验证成功")
  @Middlewares(replayProtectionMiddleware, validateBody(passkeyRegistrationVerifyBodySchema))
  public async verifyRegistration(
    @Body() body: PasskeyRegistrationVerifyRequest,
    @Request() request: TypedRequest,
  ): Promise<PasskeyRegistrationVerifyResponse> {
    const userId = request.user!.userId;
    return await this.passkeyService.verifyRegistration(userId, body.response as any, body.name);
  }

  @Post("auth/options")
  @SuccessResponse(HttpStatusCode.Ok, "生成认证选项成功")
  public async getAuthOptions(): Promise<PasskeyAuthOptionsResponse & { sessionId: string }> {
    const { options, sessionId } = await this.passkeyService.generateAuthenticationOptions();
    return { options: options, sessionId };
  }

  @Post("auth/verify")
  @SuccessResponse(HttpStatusCode.Ok, "认证成功")
  @Response<{ message: string }>(HttpStatusCode.Unauthorized, "认证失败")
  @Middlewares(replayProtectionMiddleware, validateBody(passkeyAuthVerifyBodySchema))
  public async verifyAuth(
    @Body() body: PasskeyAuthVerifyRequest,
    @Request() request: TypedRequest,
  ): Promise<PasskeyAuthVerifyResponse> {
    const userId = await this.passkeyService.verifyAuthentication(body.sessionId, body.response as any);
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UnauthorizedError("用户不存在");

    const clientIp = extractClientIp(request);
    const userAgent = this.getUserAgent(request.headers["user-agent"]);
    const fingerprint = extractClientFingerprint(request);
    const trustedDeviceToken = extractTrustedDeviceToken(request);

    validateAccountStatus(user.status, user.id, "login");

    const requiresSecondFactor = await this.twoFactorService.shouldRequireSecondFactorForPasskey(user.id);
    if (requiresSecondFactor) {
      const trustedWithinWindow = await this.twoFactorService.isTrustedWithinWindow(user.id, {
        ipAddress: clientIp,
        userAgent,
        fingerprint,
        trustedDeviceToken,
      });

      await this.businessLogService.logOperation({
        operationType: OperationType.TWO_FACTOR_TRUSTED_DEVICE_VERIFY,
        operationCategory: OperationCategory.AUTH,
        actorUserId: user.id,
        targetUserId: user.id,
        description: trustedWithinWindow ? "Passkey 登录可信设备校验命中" : "Passkey 登录可信设备校验未命中",
        success: true,
        metadata: {
          trustedWithinWindow,
          channel: "passkey_login",
        },
        ipAddress: clientIp,
        userAgent,
        requestId: this.getRequestId(request),
      });

      if (!trustedWithinWindow) {
        const challenge = await this.twoFactorService.createLoginChallenge(user.id);
        return {
          requiresTwoFactor: true,
          challengeToken: challenge.challengeToken,
          expiresIn: challenge.expiresIn,
        };
      }
    }

    return this.authService.completeAuthenticatedLogin(user, request, {
      twoFactorEnabled: requiresSecondFactor,
      grantTrustedDevice: false,
      source: "passkey_login",
      successDescription: `用户 '${user.username}' Passkey 登录成功`,
    });
  }

  @Get("list")
  @Security("jwt")
  @RequirePermission(Permission.PASSKEY_MANAGE)
  @SuccessResponse(HttpStatusCode.Ok, "获取成功")
  public async listPasskeys(@Request() request: TypedRequest): Promise<PasskeyListResponse> {
    const userId = request.user!.userId;
    const credentials = await this.passkeyService.listCredentials(userId);
    return { credentials };
  }

  @Delete("{credentialId}")
  @Security("jwt")
  @RequirePermission(Permission.PASSKEY_MANAGE)
  @SuccessResponse(HttpStatusCode.Ok, "删除成功")
  @Middlewares(replayProtectionMiddleware, validateParams(passkeyCredentialIdParamsSchema))
  public async deletePasskey(
    @Path() credentialId: string,
    @Request() request: TypedRequest,
  ): Promise<DeletePasskeyResponse> {
    const userId = request.user!.userId;
    await this.passkeyService.deleteCredential(userId, credentialId);
    return { success: true };
  }
}
