import { UserScript } from "@prisma/client";
import { UserScriptRepository } from "@/store/user-script.repository";
import type { CreateUserScriptDto, UpdateUserScriptDto, UserScriptDto } from "@/api/dto/user-script/user-script.dto";
import { NotFoundError, ForbiddenError } from "@/util/errors";

import { env } from "@/config/env";
import type { TypedRequest } from "@/types/express";
import { UserScriptIamService } from "./user-script-iam.service";
import { PermissionService } from "@/services/users/permission.service";
import { Permission } from "@quyan/shared";
import { getLogger, LogCategory } from "@/util/logger";

export class UserScriptService {
  private static instance: UserScriptService;

  private constructor(private readonly repository: UserScriptRepository = UserScriptRepository.getInstance()) {}

  public static getInstance(): UserScriptService {
    if (!UserScriptService.instance) UserScriptService.instance = new UserScriptService();
    return UserScriptService.instance;
  }

  private mapToDto(script: UserScript): UserScriptDto {
    return {
      id: script.id,
      userId: script.userId,
      name: script.name,
      description: script.description || undefined,
      content: script.content,
      createTime: script.createTime.toISOString(),
      updateTime: script.updateTime.toISOString(),
    };
  }

  public async createScript(data: CreateUserScriptDto, userId: string, request?: TypedRequest): Promise<UserScriptDto> {
    const principal =
      env.security.iamAuthorizationMode === "enforce"
        ? await UserScriptIamService.getInstance().authorizeCreate(userId, request)
        : undefined;
    const params = {
      userId,
      name: data.name,
      description: data.description,
      content: data.content,
    };
    const script = principal
      ? await this.repository.createInAccount(params, principal.accountOwnerId)
      : await this.repository.create(params);
    return this.mapToDto(script);
  }

  public async listScripts(userId: string, request?: TypedRequest): Promise<UserScriptDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (await UserScriptIamService.getInstance().list(userId, request)).map((script) => this.mapToDto(script));
    const permission = await PermissionService.getInstance().checkUserPermissions(userId, [Permission.SCRIPT_READ], {
      assumedRoleSessionId: request?.user?.roleSessionId,
    });
    if (!permission.hasPermission)
      throw new ForbiddenError("Legacy script listing denied", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    const scripts = await this.repository.findByUserId(userId);
    if (env.security.iamAuthorizationMode === "shadow" && request) {
      try {
        await UserScriptIamService.getInstance().list(userId, request);
      } catch {
        getLogger("UserScriptIam", LogCategory.SECURITY).warn("Script list shadow evaluation failed", {
          reason: "iam-list-unavailable",
        });
      }
    }
    return scripts.map((s) => this.mapToDto(s));
  }

  public async updateScript(
    id: string,
    data: UpdateUserScriptDto,
    userId: string,
    request?: TypedRequest,
  ): Promise<UserScriptDto> {
    if (env.security.iamAuthorizationMode === "enforce") {
      const { target, principal } = await UserScriptIamService.getInstance().authorizeTarget(
        id,
        userId,
        "quyan:script:UpdateScript",
        request,
      );
      return this.mapToDto(await this.repository.updateTarget(target, principal.accountOwnerId, data));
    }
    const script = await this.repository.findById(id);
    if (!script) throw new NotFoundError("脚本不存在", undefined, { messageKey: "userScript.notFound" });
    if (script.userId !== userId)
      throw new ForbiddenError("无权修改此脚本", undefined, { messageKey: "userScript.updateDenied" });

    const updated = await this.repository.update(id, {
      name: data.name,
      description: data.description,
      content: data.content,
    });
    return this.mapToDto(updated);
  }

  public async deleteScript(id: string, userId: string, request?: TypedRequest): Promise<void> {
    if (env.security.iamAuthorizationMode === "enforce") {
      const { target, principal } = await UserScriptIamService.getInstance().authorizeTarget(
        id,
        userId,
        "quyan:script:DeleteScript",
        request,
      );
      await this.repository.deleteTarget(target, principal.accountOwnerId);
      return;
    }
    const script = await this.repository.findById(id);
    if (!script) throw new NotFoundError("脚本不存在", undefined, { messageKey: "userScript.notFound" });
    if (script.userId !== userId)
      throw new ForbiddenError("无权删除此脚本", undefined, { messageKey: "userScript.deleteDenied" });

    await this.repository.delete(id);
  }
}
