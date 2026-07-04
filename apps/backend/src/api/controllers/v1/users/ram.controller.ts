import {
  Body,
  Controller,
  Delete,
  Get,
  Middlewares,
  Path,
  Post,
  Put,
  Query,
  Request,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { CustomCode } from "@/constant/custom-code";
import { RamService } from "@/services/users/ram.service";
import type { TypedRequest } from "@/types/express";
import type {
  AssumeRamRoleDto,
  AssumeRamRoleResponseDto,
  AttachPolicyBodyDto,
  BindRamRoleToGroupDto,
  BindRamRoleToUserDto,
  CreateRamPolicyDto,
  CreateRamRoleDto,
  CreateRamUserDto,
  EffectivePermissionDto,
  GetRamGroupsResponse,
  GetRamPoliciesResponse,
  GetRamPolicyAttachmentsResponse,
  GetRamRoleBindingsResponse,
  GetRamRoleSessionsResponse,
  GetRamRolesResponse,
  GetRamUsersResponse,
  RamPolicyDto,
  RamRoleDto,
  RamUserDto,
  UpdateRamPolicyDto,
  UpdateRamRoleDto,
  UpdateRamUserDto,
} from "@/api/dto/users/ram.dto";
import {
  assumeRamRoleBodySchema,
  attachPolicyBodySchema,
  authorizationQuerySchema,
  bindRamRoleToGroupBodySchema,
  bindRamRoleToUserBodySchema,
  createRamPolicyBodySchema,
  createRamRoleBodySchema,
  createRamUserBodySchema,
  detachPolicyBodySchema,
  ramGroupListQuerySchema,
  ramPolicyIdParamsSchema,
  ramRoleIdParamsSchema,
  ramSessionIdParamsSchema,
  ramUserIdParamsSchema,
  updateRamPolicyBodySchema,
  updateRamRoleBodySchema,
  updateRamUserBodySchema,
} from "@/api/schema/users/ram.schema";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";

@Route("v1/ram")
@Tags("RAM")
export class RamController extends Controller {
  private ramService = RamService.getInstance();

  @Get("users")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取RAM用户列表成功")
  @CheckPermission(Permission.RAM_USER_READ, PermissionCheckMode.ALL, "jwt")
  public async listUsers(@Request() request: TypedRequest): Promise<GetRamUsersResponse> {
    return this.ramService.listRamUsers(request.user!.userId);
  }

  @Get("groups")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取RAM可见用户组列表成功")
  @Middlewares(validateQuery(ramGroupListQuerySchema))
  @CheckPermission(Permission.RAM_USER_READ, PermissionCheckMode.ALL, "jwt")
  public async listVisibleGroups(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() keyword?: string,
  ): Promise<GetRamGroupsResponse> {
    return this.ramService.listVisibleGroups(request.user!.userId, { page, pageSize, keyword });
  }

  @Post("users")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "创建RAM用户成功")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(createRamUserBodySchema))
  @CheckPermission(Permission.RAM_USER_CREATE, PermissionCheckMode.ALL, "jwt")
  public async createUser(@Body() body: CreateRamUserDto, @Request() request: TypedRequest): Promise<RamUserDto> {
    return this.ramService.createRamUser(request.user!.userId, body);
  }

  @Put("users/{userId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "更新RAM用户成功")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateParams(ramUserIdParamsSchema), validateBody(updateRamUserBodySchema))
  @CheckPermission(Permission.RAM_USER_UPDATE, PermissionCheckMode.ALL, "jwt")
  public async updateUser(
    @Path() userId: string,
    @Body() body: UpdateRamUserDto,
    @Request() request: TypedRequest,
  ): Promise<RamUserDto> {
    return this.ramService.updateRamUser(request.user!.userId, userId, body);
  }

  @Delete("users/{userId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "删除RAM用户成功")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateParams(ramUserIdParamsSchema))
  @CheckPermission(Permission.RAM_USER_DELETE, PermissionCheckMode.ALL, "jwt")
  public async deleteUser(
    @Path() userId: string,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.deleteRamUser(request.user!.userId, userId);
    return { code: CustomCode.OK, message: "删除RAM用户成功" };
  }

  @Get("roles")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取RAM角色列表成功")
  @CheckPermission(Permission.RAM_ROLE_READ, PermissionCheckMode.ALL, "jwt")
  public async listRoles(@Request() request: TypedRequest): Promise<GetRamRolesResponse> {
    return this.ramService.listRoles(request.user!.userId);
  }

  @Post("roles")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "创建RAM角色成功")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(createRamRoleBodySchema))
  @CheckPermission(Permission.RAM_ROLE_CREATE, PermissionCheckMode.ALL, "jwt")
  public async createRole(@Body() body: CreateRamRoleDto, @Request() request: TypedRequest): Promise<RamRoleDto> {
    return this.ramService.createRole(request.user!.userId, body);
  }

  @Put("roles/{roleId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "更新RAM角色成功")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateParams(ramRoleIdParamsSchema), validateBody(updateRamRoleBodySchema))
  @CheckPermission(Permission.RAM_ROLE_UPDATE, PermissionCheckMode.ALL, "jwt")
  public async updateRole(
    @Path() roleId: string,
    @Body() body: UpdateRamRoleDto,
    @Request() request: TypedRequest,
  ): Promise<RamRoleDto> {
    return this.ramService.updateRole(request.user!.userId, roleId, body);
  }

  @Delete("roles/{roleId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "删除RAM角色成功")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateParams(ramRoleIdParamsSchema))
  @CheckPermission(Permission.RAM_ROLE_DELETE, PermissionCheckMode.ALL, "jwt")
  public async deleteRole(
    @Path() roleId: string,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.deleteRole(request.user!.userId, roleId);
    return { code: CustomCode.OK, message: "删除RAM角色成功" };
  }

  @Get("roles/{roleId}/bindings")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取RAM角色绑定成功")
  @Middlewares(validateParams(ramRoleIdParamsSchema))
  @CheckPermission(Permission.RAM_BINDING_READ, PermissionCheckMode.ALL, "jwt")
  public async listRoleBindings(
    @Path() roleId: string,
    @Request() request: TypedRequest,
    @Query() userId?: string,
  ): Promise<GetRamRoleBindingsResponse> {
    return this.ramService.listRoleBindings(request.user!.userId, roleId, userId);
  }

  @Post("roles/{roleId}/users")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "绑定RAM角色到用户成功")
  @ReplayProtected()
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(ramRoleIdParamsSchema),
    validateBody(bindRamRoleToUserBodySchema),
  )
  @CheckPermission(Permission.RAM_BINDING_CREATE, PermissionCheckMode.ALL, "jwt")
  public async bindRoleToUser(
    @Path() roleId: string,
    @Body() body: BindRamRoleToUserDto,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.bindRoleToUser(request.user!.userId, roleId, body.userId);
    return { code: CustomCode.OK, message: "绑定RAM角色到用户成功" };
  }

  @Delete("roles/{roleId}/users/{userId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "解除用户RAM角色绑定成功")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateParams(ramRoleIdParamsSchema.merge(ramUserIdParamsSchema)))
  @CheckPermission(Permission.RAM_BINDING_DELETE, PermissionCheckMode.ALL, "jwt")
  public async unbindRoleFromUser(
    @Path() roleId: string,
    @Path() userId: string,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.unbindRoleFromUser(request.user!.userId, roleId, userId);
    return { code: CustomCode.OK, message: "解除用户RAM角色绑定成功" };
  }

  @Post("roles/{roleId}/groups")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "绑定RAM角色到用户组成功")
  @ReplayProtected()
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(ramRoleIdParamsSchema),
    validateBody(bindRamRoleToGroupBodySchema),
  )
  @CheckPermission(Permission.RAM_BINDING_CREATE, PermissionCheckMode.ALL, "jwt")
  public async bindRoleToGroup(
    @Path() roleId: string,
    @Body() body: BindRamRoleToGroupDto,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.bindRoleToGroup(request.user!.userId, roleId, body.groupId);
    return { code: CustomCode.OK, message: "绑定RAM角色到用户组成功" };
  }

  @Delete("roles/{roleId}/groups/{groupId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "解除用户组RAM角色绑定成功")
  @ReplayProtected()
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(ramRoleIdParamsSchema.extend({ groupId: bindRamRoleToGroupBodySchema.shape.groupId })),
  )
  @CheckPermission(Permission.RAM_BINDING_DELETE, PermissionCheckMode.ALL, "jwt")
  public async unbindRoleFromGroup(
    @Path() roleId: string,
    @Path() groupId: string,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.unbindRoleFromGroup(request.user!.userId, roleId, groupId);
    return { code: CustomCode.OK, message: "解除用户组RAM角色绑定成功" };
  }

  @Post("assume-role")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "扮演RAM角色成功")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(assumeRamRoleBodySchema))
  @CheckPermission(Permission.RAM_ASSUME_ROLE, PermissionCheckMode.ALL, "jwt")
  public async assumeRole(
    @Body() body: AssumeRamRoleDto,
    @Request() request: TypedRequest,
  ): Promise<AssumeRamRoleResponseDto> {
    return this.ramService.assumeRole(request.user!.userId, body);
  }

  @Get("sessions")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取RAM角色会话成功")
  @CheckPermission(Permission.RAM_SESSION_READ, PermissionCheckMode.ALL, "jwt")
  public async listSessions(
    @Request() request: TypedRequest,
    @Query() principalUserId?: string,
  ): Promise<GetRamRoleSessionsResponse> {
    return this.ramService.listRoleSessions(request.user!.userId, principalUserId);
  }

  @Delete("sessions/{sessionId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "撤销RAM角色会话成功")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateParams(ramSessionIdParamsSchema))
  @CheckPermission(Permission.RAM_SESSION_REVOKE, PermissionCheckMode.ALL, "jwt")
  public async revokeSession(
    @Path() sessionId: string,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.revokeRoleSession(request.user!.userId, sessionId);
    return { code: CustomCode.OK, message: "撤销RAM角色会话成功" };
  }

  // ── 权限策略 ──

  @Get("policies")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取权限策略列表成功")
  @CheckPermission(Permission.RAM_POLICY_READ, PermissionCheckMode.ALL, "jwt")
  public async listPolicies(@Request() request: TypedRequest): Promise<GetRamPoliciesResponse> {
    return this.ramService.listPolicies(request.user!.userId);
  }

  @Post("policies")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "创建权限策略成功")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(createRamPolicyBodySchema))
  @CheckPermission(Permission.RAM_POLICY_CREATE, PermissionCheckMode.ALL, "jwt")
  public async createPolicy(@Body() body: CreateRamPolicyDto, @Request() request: TypedRequest): Promise<RamPolicyDto> {
    return this.ramService.createPolicy(request.user!.userId, body);
  }

  @Put("policies/{policyId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "更新权限策略成功")
  @ReplayProtected()
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(ramPolicyIdParamsSchema),
    validateBody(updateRamPolicyBodySchema),
  )
  @CheckPermission(Permission.RAM_POLICY_UPDATE, PermissionCheckMode.ALL, "jwt")
  public async updatePolicy(
    @Path() policyId: string,
    @Body() body: UpdateRamPolicyDto,
    @Request() request: TypedRequest,
  ): Promise<RamPolicyDto> {
    return this.ramService.updatePolicy(request.user!.userId, policyId, body);
  }

  @Delete("policies/{policyId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "删除权限策略成功")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateParams(ramPolicyIdParamsSchema))
  @CheckPermission(Permission.RAM_POLICY_DELETE, PermissionCheckMode.ALL, "jwt")
  public async deletePolicy(
    @Path() policyId: string,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.deletePolicy(request.user!.userId, policyId);
    return { code: CustomCode.OK, message: "删除权限策略成功" };
  }

  @Get("policies/{policyId}/attachments")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取权限策略绑定列表成功")
  @Middlewares(validateParams(ramPolicyIdParamsSchema))
  @CheckPermission(Permission.RAM_POLICY_READ, PermissionCheckMode.ALL, "jwt")
  public async listPolicyAttachments(
    @Path() policyId: string,
    @Request() request: TypedRequest,
  ): Promise<GetRamPolicyAttachmentsResponse> {
    return this.ramService.listPolicyAttachments(request.user!.userId, policyId);
  }

  @Post("attach-policy")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "绑定权限策略成功")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(attachPolicyBodySchema))
  @CheckPermission(Permission.RAM_POLICY_ATTACH, PermissionCheckMode.ALL, "jwt")
  public async attachPolicy(
    @Body() body: AttachPolicyBodyDto,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.attachPolicy(request.user!.userId, body);
    return { code: CustomCode.OK, message: "绑定权限策略成功" };
  }

  @Post("detach-policy")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "解绑权限策略成功")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(detachPolicyBodySchema))
  @CheckPermission(Permission.RAM_POLICY_DETACH, PermissionCheckMode.ALL, "jwt")
  public async detachPolicy(
    @Body() body: AttachPolicyBodyDto,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.detachPolicy(request.user!.userId, body);
    return { code: CustomCode.OK, message: "解绑权限策略成功" };
  }

  // ── 授权概览 ──

  @Get("authorization/effective-permissions")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取用户有效权限成功")
  @Middlewares(validateQuery(authorizationQuerySchema))
  @CheckPermission(Permission.RAM_USER_READ, PermissionCheckMode.ALL, "jwt")
  public async getUserEffectivePermissions(
    @Request() request: TypedRequest,
    @Query() userId: string,
  ): Promise<EffectivePermissionDto> {
    return this.ramService.getUserEffectivePermissions(request.user!.userId, userId);
  }
}
