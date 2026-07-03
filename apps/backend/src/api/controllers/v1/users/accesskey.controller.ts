import { Controller, Get, Post, Delete, Route, Security, Request, Path, Body, Middlewares } from "@tsoa/runtime";
import { AccessKeyService } from "@/services/users/accesskey.service";
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import type {
  CreateAccessKeyDto,
  AccessKeyDto,
  SendAccessKeyCreationVerificationCodeResponse,
} from "@/api/dto/users/accesskey.dto";
import { accesskeyIdParamsSchema, createAccessKeyBodySchema } from "@/api/schema/users/accesskey.schema";
import { validateBody, validateParams } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { ForbiddenError } from "@/util/errors";

function assertNoOAuthAccessToken(request: TypedRequest, action: "读取" | "删除"): void {
  if (request.oauthAccessToken) throw new ForbiddenError(`第三方应用无权${action}已有 Access Key`);
}

@Route("v1/accesskeys")
export class AccessKeyController extends Controller {
  @Post()
  @Security("jwt", ["accesskey"])
  @CheckPermission(Permission.ACCESSKEY_CREATE, PermissionCheckMode.ALL, "jwt")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createAccessKeyBodySchema),
  )
  public async createAccessKey(
    @Request() request: TypedRequest,
    @Body() body: CreateAccessKeyDto,
  ): Promise<AccessKeyDto> {
    const service = new AccessKeyService();
    return service.generateKeyForUser(request.user!.userId, body, request);
  }

  @Get()
  @Security("jwt")
  @CheckPermission(Permission.ACCESSKEY_READ, PermissionCheckMode.ALL, "jwt")
  public async listAccessKeys(@Request() request: TypedRequest): Promise<AccessKeyDto[]> {
    assertNoOAuthAccessToken(request, "读取");
    const service = new AccessKeyService();
    return service.listKeys(request.user!.userId);
  }

  @Delete("{id}")
  @Security("jwt")
  @CheckPermission(Permission.ACCESSKEY_DELETE, PermissionCheckMode.ALL, "jwt")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code", alwaysRequire: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code", alwaysRequire: true }),
    replayProtectionMiddleware,
    validateParams(accesskeyIdParamsSchema),
  )
  public async deleteAccessKey(@Request() request: TypedRequest, @Path() id: string): Promise<boolean> {
    assertNoOAuthAccessToken(request, "删除");
    const service = new AccessKeyService();
    await service.revokeKey(id, request.user!.userId, request);
    return true;
  }

  @Post("send-accesskey-creation-verification-code")
  @Security("jwt", ["accesskey"])
  @CheckPermission(Permission.ACCESSKEY_CREATE, PermissionCheckMode.ALL, "jwt")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }), replayProtectionMiddleware)
  public async sendAccessKeyCreationVerificationCode(
    @Request() request: TypedRequest,
  ): Promise<SendAccessKeyCreationVerificationCodeResponse> {
    const service = new AccessKeyService();
    const sent = await service.sendAccessKeyCreationVerificationCodeForUser(request.user!.userId);
    return {
      message: sent ? "验证码已发送" : "当前账户已启用二次验证，无需额外邮箱验证码",
    };
  }
}
