import { Body, Controller, Middlewares, Post, Request, Route, Security, SuccessResponse, Tags } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { ImpersonationService } from "@/services/users/impersonation.service";
import type { StartImpersonationDto, StartImpersonationResponse } from "@/api/dto/users/impersonation.dto";
import { Permission } from "@/constant/permission";
import { RequireAnyPermission } from "@/util/permission/permission-decorator";
import { validateBody } from "@/middleware/validation";
import { startImpersonationBodySchema } from "@/api/schema/users/impersonation.schema";
import type { TypedRequest } from "@/types/express";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";

/**
 * 用户模拟相关接口
 * 允许拥有模拟权限的管理员以其他用户身份访问系统
 */
@Route("v1/impersonation")
@Tags("Impersonation")
export class ImpersonationController extends Controller {
  private impersonationService = new ImpersonationService();

  /**
   * 开始模拟指定用户
   *
   * 需要 user:impersonate:view 或 user:impersonate:act 权限之一。
   * 返回一个短期 access token（1小时），无 refresh token。
   * 将该 token 替换当前 token 即可以目标用户身份操作系统。
   */
  @Post("start")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "模拟成功")
  @ReplayProtected()
  @RequireAnyPermission([Permission.USER_IMPERSONATE_VIEW, Permission.USER_IMPERSONATE_ACT])
  @Middlewares(replayProtectionMiddleware, validateBody(startImpersonationBodySchema))
  public async startImpersonation(
    @Body() body: StartImpersonationDto,
    @Request() request: TypedRequest,
  ): Promise<StartImpersonationResponse> {
    const impersonatorId = request.user!.userId;
    const result = await this.impersonationService.startImpersonation(impersonatorId, body.targetUserId, request);
    await this.impersonationService.issueCrossSiteHandoff(request, result.access_token);
    return result;
  }

  /**
   * Restores a short-lived impersonation token after a cross-site navigation.
   * An HttpOnly cookie carries only an opaque first-party handoff ID; normal
   * users receive null and continue through the regular refresh-cookie flow.
   */
  @Post("restore")
  public async restoreImpersonation(@Request() request: TypedRequest): Promise<StartImpersonationResponse | null> {
    return this.impersonationService.restoreImpersonation(request);
  }
}
