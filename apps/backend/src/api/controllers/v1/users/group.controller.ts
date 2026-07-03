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
  Query,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { GroupService } from "@/services/users/group.service";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type {
  CreateGroupDto,
  UpdateGroupDto,
  SetGroupPermissionsDto,
  GetAllGroupsData,
  GetAllGroupsResponse,
  GetGroupByIdResponse,
  CreateGroupResponse,
  UpdateGroupResponse,
} from "@/api/dto/users/group.dto";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import { UserService } from "@/services/users/user.service";
import { ForbiddenError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { ErrorResponse } from "@/api/response";
import {
  createGroupBodySchema,
  groupIdParamsSchema,
  groupListQuerySchema,
  setGroupPermissionsBodySchema,
  updateGroupBodySchema,
} from "@/api/schema/users/group.schema";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { setResponseMessageKey } from "@/util/response-wrapper";

const logger = getLogger("GroupController", LogCategory.BUSINESS);

@Route("v1/groups")
@Tags("Group Management")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class GroupController extends Controller {
  private groupService = new GroupService();
  private userService = new UserService();

  @Get("")
  @Security("jwt")
  @RequirePermission(Permission.GROUP_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(validateQuery(groupListQuerySchema))
  public async getAllGroups(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() keyword?: string,
    @Query() hasRamPermission?: boolean,
  ): Promise<GetAllGroupsResponse> {
    const currentUserId = request.user!.userId;

    // If pagination params provided, use paginated query
    if (page && pageSize)
      return this.groupService.getVisibleGroupsPage({
        actorUserId: currentUserId,
        page,
        pageSize,
        keyword,
        hasRamPermission,
      });

    // Otherwise return all visible groups (backwards compatible)
    const groups = await this.groupService.getVisibleGroups(currentUserId);
    return {
      groups,
      total: groups.length,
      page: 1,
      pageSize: groups.length,
      hasMore: false,
    };
  }

  @Get("{groupId}")
  @Security("jwt")
  @RequirePermission(Permission.GROUP_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(validateParams(groupIdParamsSchema))
  public async getGroupById(@Path() groupId: string, @Request() request: TypedRequest): Promise<GetGroupByIdResponse> {
    const group = await this.groupService.getGroupById(groupId);
    if (!group) throw new ForbiddenError("用户组不存在", undefined, { messageKey: "group.notFound" });
    return group;
  }

  @Post("")
  @Security("jwt")
  @RequirePermission(Permission.GROUP_CREATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "创建失败")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createGroupBodySchema),
  )
  public async createGroup(
    @Body() body: CreateGroupDto,
    @Request() request: TypedRequest,
  ): Promise<CreateGroupResponse> {
    const currentUserId = request.user!.userId;
    const isAdmin = await this.userService.isAdmin(currentUserId);

    if (!isAdmin) {
      const actorLevel = await this.userService.getUserGroupLevel(currentUserId);
      if (actorLevel != null && body.level <= actorLevel)
        throw new ForbiddenError("不能创建同级或更高级别的组", undefined, { messageKey: "group.cannotCreatePeer" });
    }

    return this.groupService.createGroup(body, currentUserId, request);
  }

  @Put("{groupId}")
  @Security("jwt")
  @RequirePermission(Permission.GROUP_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "更新失败")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(groupIdParamsSchema),
    validateBody(updateGroupBodySchema),
  )
  public async updateGroup(
    @Body() body: UpdateGroupDto,
    @Request() request: TypedRequest,
    @Path() groupId: string,
  ): Promise<UpdateGroupResponse> {
    const currentUserId = request.user!.userId;
    const isAdmin = await this.userService.isAdmin(currentUserId);
    const targetGroup = await this.groupService.getGroupById(groupId);
    if (!targetGroup) throw new ForbiddenError("用户组不存在", undefined, { messageKey: "group.notFound" });

    if (!isAdmin) {
      const actorLevel = await this.userService.getUserGroupLevel(currentUserId);
      if (actorLevel != null && targetGroup.level <= actorLevel)
        throw new ForbiddenError("不能修改同级或更高级别的组", undefined, { messageKey: "group.cannotModifyPeer" });

      if (body.level !== undefined && actorLevel != null && body.level <= actorLevel)
        throw new ForbiddenError("不能将组级别设置为同级或更高", undefined, { messageKey: "group.cannotRaiseToPeer" });
    }

    return this.groupService.updateGroup(groupId, body, currentUserId, request);
  }

  @Delete("{groupId}")
  @Security("jwt")
  @RequirePermission(Permission.GROUP_DELETE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "删除失败")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(groupIdParamsSchema),
  )
  public async deleteGroup(@Request() request: TypedRequest, @Path() groupId: string): Promise<{ message: string }> {
    const currentUserId = request.user!.userId;
    const isAdmin = await this.userService.isAdmin(currentUserId);
    const targetGroup = await this.groupService.getGroupById(groupId);
    if (!targetGroup) throw new ForbiddenError("用户组不存在", undefined, { messageKey: "group.notFound" });

    if (!isAdmin) {
      const actorLevel = await this.userService.getUserGroupLevel(currentUserId);
      if (actorLevel != null && targetGroup.level <= actorLevel)
        throw new ForbiddenError("不能删除同级或更高级别的组", undefined, { messageKey: "group.cannotDeletePeer" });
    }

    await this.groupService.deleteGroup(groupId, currentUserId, request);
    setResponseMessageKey(request, "group.deleted");
    return { message: "删除成功" };
  }

  @Get("{groupId}/permissions")
  @Security("jwt")
  @RequirePermission(Permission.GROUP_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(validateParams(groupIdParamsSchema))
  public async getGroupPermissions(@Path() groupId: string, @Request() request: TypedRequest): Promise<string[]> {
    return this.groupService.getGroupPermissions(groupId);
  }

  @Put("{groupId}/permissions")
  @Security("jwt")
  @RequirePermission(Permission.GROUP_PERMISSION_ADD)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(groupIdParamsSchema),
    validateBody(setGroupPermissionsBodySchema),
  )
  public async setGroupPermissions(
    @Body() body: SetGroupPermissionsDto,
    @Request() request: TypedRequest,
    @Path() groupId: string,
  ): Promise<{ message: string }> {
    const currentUserId = request.user!.userId;
    const isAdmin = await this.userService.isAdmin(currentUserId);
    const targetGroup = await this.groupService.getGroupById(groupId);
    if (!targetGroup) throw new ForbiddenError("用户组不存在", undefined, { messageKey: "group.notFound" });

    if (!isAdmin) {
      const actorLevel = await this.userService.getUserGroupLevel(currentUserId);
      if (actorLevel != null && targetGroup.level <= actorLevel)
        throw new ForbiddenError("不能修改同级或更高级别组的权限", undefined, {
          messageKey: "group.cannotModifyPermissionsForPeer",
        });
    }

    await this.groupService.setGroupPermissions(groupId, body.permissions, currentUserId, request);
    setResponseMessageKey(request, "group.permissionsUpdated");
    return { message: "权限更新成功" };
  }
}
