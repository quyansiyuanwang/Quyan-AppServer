import {
  Body,
  Controller,
  Get,
  Path,
  Post,
  Put,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
  Middlewares,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { permissionService } from "@/services/users/permission.service";
import type {
  SetUserPermissionDTO,
  AddPermissionsDTO,
  RemovePermissionsDTO,
  CheckPermissionsDTO,
  UserFullPermissionsDTO,
  PermissionCheckResultDTO,
  AllPermissionsDTO,
} from "@/api/dto/users/permission.dto";
import { ALL_PERMISSIONS, Permission } from "@/constant/permission";
import { UserService } from "@/services/users/user.service";
import { GroupRepository } from "@/store/users/group.repository";
import type { ValidationErrorResponse, BaseResponse } from "@/api/dto/common/common.dto";
import { ForbiddenError, NotFoundError } from "@/util/errors";
import { RequirePermission, RequireAllPermissions } from "@/util/permission/permission-decorator";
import { CustomCode } from "@/constant/custom-code";
import type { TypedRequest } from "@/types/express";
import { diff } from "@/util/function-tools";
import type { ErrorResponse } from "@/api/response";
import {
  addOrRemovePermissionsBodySchema,
  checkPermissionsBodySchema,
  permissionGroupIdParamsSchema,
  permissionUserIdParamsSchema,
  setUserPermissionsBodySchema,
} from "@/api/schema/users/permission.schema";
import { validateBody, validateParams } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { setResponseMessageKey } from "@/util/response-wrapper";

/**
 * 权限管理相关接口
 */
@Route("v1/permissions")
@Tags("Permission")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class PermissionController extends Controller {
  /**
   * 获取权限列表
   * @summary 获取权限列表
   * @returns 用户的权限列表（如果有PERMISSION_VIEW权限则返回所有权限，否则返回用户自己的权限）
   */
  @Get("all")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  public async getAllPermissions(@Request() request: TypedRequest): Promise<AllPermissionsDTO> {
    const currentUserId = request.user!.userId;
    const hasViewPermission = await permissionService.hasPermission(currentUserId, Permission.PERMISSION_VIEW);

    let permissionList: string[];

    if (hasViewPermission) permissionList = ALL_PERMISSIONS;
    else {
      const userPermissions = await permissionService.getUserFullPermissions(currentUserId);
      permissionList = userPermissions?.effectivePermissions || [];
    }

    const permissions = permissionList.map((perm) => {
      const [category, name] = perm.split(":");
      return {
        value: perm,
        name: name || perm,
        category: category,
      };
    });

    return {
      permissions,
    };
  }

  /**
   * 获取指定用户的完整权限信息
   * @summary 获取用户权限
   * @param userId 用户ID
   * @returns 用户的完整权限信息
   */
  @Get("user/{userId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "用户不存在")
  @Middlewares(validateParams(permissionUserIdParamsSchema))
  public async getUserPermissions(
    @Path() userId: string,
    @Request() request: TypedRequest,
  ): Promise<UserFullPermissionsDTO> {
    const currentUserId = request.user?.userId;
    const tarUserId = !userId ? currentUserId! : userId;
    const isSelf = currentUserId === tarUserId;

    if (!isSelf && !(await permissionService.hasPermission(currentUserId!, Permission.PERMISSION_VIEW)))
      throw new NotFoundError("用户不存在", undefined, { messageKey: "permission.userNotFound" });

    const permissions = await permissionService.getUserFullPermissions(tarUserId);
    if (!permissions) throw new NotFoundError("用户不存在", undefined, { messageKey: "permission.userNotFound" });

    return permissions;
  }

  /**
   * 设置用户的权限配置
   * @summary 设置用户权限配置
   * @param userId 用户ID
   * @param body 权限配置
   * @returns 操作结果
   */
  @Put("user/{userId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "请求参数错误")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.PERMISSION_ADD)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(permissionUserIdParamsSchema),
    validateBody(setUserPermissionsBodySchema),
  )
  public async setUserPermissions(
    @Request() request: TypedRequest,
    @Path() userId: string,
    @Body() body: SetUserPermissionDTO,
  ): Promise<BaseResponse> {
    const currentUserId = request.user!.userId;
    await permissionService.setUserPermissionConfig(currentUserId, userId, body, request);
    setResponseMessageKey(request, "permission.userConfigUpdated");

    return {
      code: CustomCode.OK,
      message: "权限配置更新成功",
    };
  }

  /**
   * 为用户添加额外权限
   * @summary 添加用户权限
   * @param userId 用户ID
   * @param body 要添加的权限列表
   * @returns 操作结果
   */
  @Post("user/{userId}/add")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "请求参数错误")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.PERMISSION_ADD)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(permissionUserIdParamsSchema),
    validateBody(addOrRemovePermissionsBodySchema),
  )
  public async addUserPermissions(
    @Request() request: TypedRequest,
    @Path() userId: string,
    @Body() body: AddPermissionsDTO,
  ): Promise<BaseResponse> {
    const currentUserId = request.user!.userId;
    await permissionService.addUserPermissions(currentUserId, userId, body.permissions, request);
    setResponseMessageKey(request, "permission.userPermissionsAdded");

    return {
      code: CustomCode.OK,
      message: "权限添加成功",
    };
  }

  /**
   * 移除用户的权限
   * @summary 移除用户权限
   * @param userId 用户ID
   * @param body 要移除的权限列表
   * @returns 操作结果
   */
  @Post("user/{userId}/remove")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "请求参数错误")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.PERMISSION_REMOVE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(permissionUserIdParamsSchema),
    validateBody(addOrRemovePermissionsBodySchema),
  )
  public async removeUserPermissions(
    @Request() request: TypedRequest,
    @Path() userId: string,
    @Body() body: RemovePermissionsDTO,
  ): Promise<BaseResponse> {
    const currentUserId = request.user!.userId;
    await permissionService.removeUserPermissions(currentUserId, userId, body.permissions, request);
    setResponseMessageKey(request, "permission.userPermissionsRemoved");

    return {
      code: CustomCode.OK,
      message: "权限移除成功",
    };
  }

  /**
   * 清空用户的权限配置
   * @summary 清空用户权限配置
   * @param userId 用户ID
   * @returns 操作结果
   */
  @Post("user/{userId}/clear")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequireAllPermissions([Permission.PERMISSION_REMOVE, Permission.PERMISSION_ADD])
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(permissionUserIdParamsSchema),
  )
  public async clearUserPermissions(@Request() request: TypedRequest, @Path() userId: string): Promise<BaseResponse> {
    const currentUserId = request.user!.userId;
    await permissionService.clearUserPermissionConfig(currentUserId, userId, request);
    setResponseMessageKey(request, "permission.userConfigCleared");

    return {
      code: CustomCode.OK,
      message: "权限配置已清空",
    };
  }

  /**
   * 检查用户是否拥有指定权限
   * @summary 检查用户权限
   * @param body 检查请求参数
   * @returns 权限检查结果
   */
  @Post("check")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(validateBody(checkPermissionsBodySchema))
  public async checkPermissions(
    @Request() request: TypedRequest,
    @Body() body: CheckPermissionsDTO,
  ): Promise<PermissionCheckResultDTO> {
    const currentUserId = request.user!.userId;
    if (body.userId !== currentUserId) {
      const hasView = await permissionService.hasPermission(currentUserId, Permission.PERMISSION_VIEW);
      if (!hasView)
        throw new ForbiddenError("权限不足", undefined, { messageKey: "permission.insufficientPermission" });
    }
    return await permissionService.checkUserPermissions(body.userId, body.permissions);
  }

  /**
   * 获取用户组的权限列表
   * @summary 获取用户组权限
   * @param groupId 用户组ID
   * @returns 用户组的权限列表
   */
  @Get("group/{groupId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @RequirePermission(Permission.PERMISSION_VIEW)
  @Middlewares(validateParams(permissionGroupIdParamsSchema))
  public async getGroupPermissions(
    @Request() request: TypedRequest,
    @Path() groupId: string,
  ): Promise<{ permissions: Permission[] }> {
    const permissions = await permissionService.getGroupPermissions(groupId);

    return {
      permissions,
    };
  }

  /**
   * 设置用户组的权限列表
   * @summary 设置用户组权限
   * @param groupId 用户组ID
   * @param body 权限列表
   * @returns 操作结果
   */
  @Put("group/{groupId}/permissions")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "请求参数错误")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(permissionGroupIdParamsSchema),
    validateBody(addOrRemovePermissionsBodySchema),
  )
  public async setGroupPermissions(
    @Request() request: TypedRequest,
    @Path() groupId: string,
    @Body() body: AddPermissionsDTO,
  ): Promise<BaseResponse> {
    const currentUserId = request.user!.userId;
    const hasAddPerm = await permissionService.hasPermission(currentUserId, Permission.PERMISSION_ADD);
    const hasRemovePerm = await permissionService.hasPermission(currentUserId, Permission.PERMISSION_REMOVE);

    const currentPerm = await permissionService.getGroupPermissions(groupId);
    const diffs = diff(currentPerm, body.permissions);

    if (diffs.added.length !== 0 && !hasAddPerm)
      throw new ForbiddenError("权限不足，无法添加权限", CustomCode.PERMISSION_DENIED, {
        messageKey: "permission.insufficientAddPermission",
      });
    if (diffs.removed.length !== 0 && !hasRemovePerm)
      throw new ForbiddenError("权限不足，无法移除权限", CustomCode.PERMISSION_DENIED, {
        messageKey: "permission.insufficientRemovePermission",
      });

    // 层级检查：非管理员不能修改同级或更高级别组的权限
    const userService = new UserService();
    const groupRepo = GroupRepository.getInstance();
    const targetGroup = await groupRepo.findById(groupId);
    if (!targetGroup) throw new NotFoundError("用户组不存在", undefined, { messageKey: "permission.groupNotFound" });
    const isAdmin = await userService.isAdmin(currentUserId);
    if (!isAdmin) {
      const actorLevel = await userService.getUserGroupLevel(currentUserId);
      if (actorLevel != null && targetGroup.level <= actorLevel)
        throw new ForbiddenError("不能修改同级或更高级别组的权限", undefined, {
          messageKey: "permission.cannotModifyPeerGroup",
        });
    }

    await permissionService.setGroupPermissions(groupId, body.permissions, currentUserId, request);
    setResponseMessageKey(request, "permission.groupPermissionsUpdated");

    return {
      code: CustomCode.OK,
      message: "用户组权限设置成功",
    };
  }
}
