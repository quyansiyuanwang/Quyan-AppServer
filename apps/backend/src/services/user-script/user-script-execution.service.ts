import { UserScriptExecution } from "@prisma/client";
import { UserScriptExecutionRepository } from "@/store/user-script-execution.repository";
import { UserScriptRepository } from "@/store/user-script.repository";
import type { CreateExecutionDto, UserScriptExecutionDto } from "@/api/dto/user-script/user-script-execution.dto";
import { ForbiddenError, NotFoundError } from "@/util/errors";

import { env } from "@/config/env";
import type { TypedRequest } from "@/types/express";
import { UserScriptExecutionIamService } from "./user-script-execution-iam.service";
import { PermissionService } from "@/services/users/permission.service";
import { Permission } from "@quyan/shared";
import { getLogger, LogCategory } from "@/util/logger";

export class UserScriptExecutionService {
  private static instance: UserScriptExecutionService;

  private constructor(
    private readonly repository: UserScriptExecutionRepository = UserScriptExecutionRepository.getInstance(),
    private readonly scriptRepository: UserScriptRepository = UserScriptRepository.getInstance(),
  ) {}

  public static getInstance(): UserScriptExecutionService {
    if (!UserScriptExecutionService.instance) UserScriptExecutionService.instance = new UserScriptExecutionService();
    return UserScriptExecutionService.instance;
  }

  private mapToDto(execution: UserScriptExecution): UserScriptExecutionDto {
    return {
      id: execution.id,
      userId: execution.userId,
      scriptId: execution.scriptId ?? undefined,
      scriptName: execution.scriptName,
      contentSnapshot: execution.contentSnapshot,
      output: execution.output,
      durationMs: execution.durationMs,
      createTime: execution.createTime.toISOString(),
    };
  }

  public async saveExecution(
    userId: string,
    dto: CreateExecutionDto,
    request?: TypedRequest,
  ): Promise<UserScriptExecutionDto> {
    const grant =
      env.security.iamAuthorizationMode === "enforce"
        ? await UserScriptExecutionIamService.getInstance().authorizeSave(userId, dto.scriptId, request)
        : undefined;
    const execution = await this.repository.create(
      {
        userId,
        scriptId: dto.scriptId,
        scriptName: dto.scriptName,
        contentSnapshot: dto.contentSnapshot,
        output: dto.output,
        durationMs: dto.durationMs,
      },
      grant?.principal.accountOwnerId,
      grant?.target,
    );
    return this.mapToDto(execution);
  }

  public async listExecutions(userId: string, request?: TypedRequest): Promise<UserScriptExecutionDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (await UserScriptExecutionIamService.getInstance().list(userId, request)).map((row) => this.mapToDto(row));
    await this.checkLegacyList(userId, request);
    const executions = await this.repository.findByUserId(userId);
    await this.compareShadow(userId, request);
    return executions.map((e) => this.mapToDto(e));
  }

  public async listExecutionsByScript(
    scriptId: string,
    userId: string,
    request?: TypedRequest,
  ): Promise<UserScriptExecutionDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (await UserScriptExecutionIamService.getInstance().list(userId, request, scriptId)).map((row) =>
        this.mapToDto(row),
      );
    await this.checkLegacyList(userId, request);
    const script = await this.scriptRepository.findById(scriptId);
    if (!script) throw new NotFoundError("脚本不存在", undefined, { messageKey: "userScript.notFound" });
    if (script.userId !== userId)
      throw new ForbiddenError("无权查看此脚本的历史", undefined, { messageKey: "userScript.historyDenied" });

    const executions = await this.repository.findByScriptId(scriptId, userId);
    await this.compareShadow(userId, request, scriptId);
    return executions.map((e) => this.mapToDto(e));
  }
  private async checkLegacyList(userId: string, request?: TypedRequest) {
    const result = await PermissionService.getInstance().checkUserPermissions(userId, [Permission.SCRIPT_READ], {
      assumedRoleSessionId: request?.user?.roleSessionId,
    });
    if (!result.hasPermission)
      throw new ForbiddenError("Legacy script history denied", undefined, {
        messageKey: "permission.insufficientPermission",
      });
  }
  private async compareShadow(userId: string, request?: TypedRequest, scriptId?: string) {
    if (env.security.iamAuthorizationMode !== "shadow" || !request) return;
    try {
      await UserScriptExecutionIamService.getInstance().list(userId, request, scriptId);
    } catch {
      getLogger("UserScriptExecutionIam", LogCategory.SECURITY).warn("Script history shadow evaluation failed", {
        reason: "iam-list-unavailable",
      });
    }
  }
}
