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
  Middlewares,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { UserScriptExecutionService } from "@/services/user-script/user-script-execution.service";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type { CreateExecutionDto, UserScriptExecutionDto } from "@/api/dto/user-script/user-script-execution.dto";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import type { ErrorResponse } from "@/api/response";
import {
  createExecutionBodySchema,
  executionScriptIdParamsSchema,
} from "@/api/schema/user-script/user-script-execution.schema";
import { validateBody, validateParams } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";

@Route("v1/user-scripts/executions")
@Tags("User Script Execution")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class UserScriptExecutionController extends Controller {
  private service = UserScriptExecutionService.getInstance();

  /**
   * 获取当前用户的所有执行历史
   */
  @Get("")
  @Security("jwt")
  @RequirePermission(Permission.SCRIPT_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async listExecutions(@Request() request: TypedRequest): Promise<UserScriptExecutionDto[]> {
    const userId = request.user!.userId;
    return this.service.listExecutions(userId);
  }

  /**
   * 获取某脚本的执行历史
   */
  @Get("{scriptId}")
  @Security("jwt")
  @RequirePermission(Permission.SCRIPT_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "脚本不存在")
  @Middlewares(validateParams(executionScriptIdParamsSchema))
  public async listByScript(
    @Path() scriptId: string,
    @Request() request: TypedRequest,
  ): Promise<UserScriptExecutionDto[]> {
    const userId = request.user!.userId;
    return this.service.listExecutionsByScript(scriptId, userId);
  }

  /**
   * 保存执行历史
   */
  @Post("")
  @Security("jwt")
  @RequirePermission(Permission.SCRIPT_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(replayProtectionMiddleware, validateBody(createExecutionBodySchema))
  public async saveExecution(
    @Body() body: CreateExecutionDto,
    @Request() request: TypedRequest,
  ): Promise<UserScriptExecutionDto> {
    const userId = request.user!.userId;
    return this.service.saveExecution(userId, body);
  }
}
