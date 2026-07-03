import {
  Body,
  Get,
  Post,
  Path,
  Route,
  Security,
  SuccessResponse,
  Response,
  Tags,
  Controller,
  Request,
  Put,
  Delete,
  Middlewares,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { UserScriptService } from "@/services/user-script/user-script.service";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type { CreateUserScriptDto, UpdateUserScriptDto, UserScriptDto } from "@/api/dto/user-script/user-script.dto";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import type { ErrorResponse } from "@/api/response";
import {
  createUserScriptBodySchema,
  updateUserScriptBodySchema,
  userScriptIdParamsSchema,
} from "@/api/schema/user-script/user-script.schema";
import { validateBody, validateParams } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";

@Route("v1/user-scripts")
@Tags("User Script Manager")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class UserScriptController extends Controller {
  private service = UserScriptService.getInstance();

  /**
   * 获取当前用户的所有脚本
   */
  @Get("")
  @Security("jwt")
  @RequirePermission(Permission.SCRIPT_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async listScripts(@Request() request: TypedRequest): Promise<UserScriptDto[]> {
    const userId = request.user!.userId;
    return this.service.listScripts(userId);
  }

  /**
   * 创建脚本
   */
  @Post("")
  @Security("jwt")
  @RequirePermission(Permission.SCRIPT_CREATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "创建失败")
  @Middlewares(replayProtectionMiddleware, validateBody(createUserScriptBodySchema))
  public async createScript(
    @Body() body: CreateUserScriptDto,
    @Request() request: TypedRequest,
  ): Promise<UserScriptDto> {
    const userId = request.user!.userId;
    return this.service.createScript(body, userId);
  }

  /**
   * 更新脚本
   */
  @Put("{id}")
  @Security("jwt")
  @RequirePermission(Permission.SCRIPT_CREATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "脚本不存在")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(userScriptIdParamsSchema),
    validateBody(updateUserScriptBodySchema),
  )
  public async updateScript(
    @Path() id: string,
    @Body() body: UpdateUserScriptDto,
    @Request() request: TypedRequest,
  ): Promise<UserScriptDto> {
    const userId = request.user!.userId;
    return this.service.updateScript(id, body, userId);
  }

  /**
   * 删除脚本
   */
  @Delete("{id}")
  @Security("jwt")
  @RequirePermission(Permission.SCRIPT_DELETE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "脚本不存在")
  @Middlewares(replayProtectionMiddleware, validateParams(userScriptIdParamsSchema))
  public async deleteScript(@Path() id: string, @Request() request: TypedRequest): Promise<boolean> {
    const userId = request.user!.userId;
    await this.service.deleteScript(id, userId);
    return true;
  }
}
