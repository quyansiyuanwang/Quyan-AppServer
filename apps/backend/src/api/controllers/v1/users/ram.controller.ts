import { iamManagementPaginationSchema, iamManagementSearchPaginationSchema } from "@/iam/management-pagination";
import type { RamRolePageDto, RamPolicyPageDto } from "@/api/dto/users/ram.dto";
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
import type {
  CreateRamPolicyVersionDto,
  SetRamRoleTrustPolicyDto,
  SetDefaultRamPolicyVersionDto,
  RamPolicyVersionPageDto,
  CheckIamDelegationResponseDto,
  DiagnoseIamPolicyDto,
  DiagnoseIamPolicyResponseDto,
  GenerateIamPolicyDraftDto,
  GenerateIamPolicyDraftResponseDto,
  ValidateIamPolicyDto,
  ValidateIamPolicyResponseDto,
  SimulateIamPolicyDto,
  SimulateIamPolicyResponseDto,
  AddRamResourceGroupMemberDto,
  CreateRamAuthorizationDto,
  CreateRamResourceGroupDto,
  RamAuthorizationDto,
  RamAuthorizationPageDto,
  RamResourceGroupPageDto,
  RamResourceGroupMemberPageDto,
  RamResourceGroupDto,
  RamVisibleGroupPageDto,
  RamUserPageDto,
  RamRoleSessionPageDto,
  RamRoleBindingPageDto,
  RamPolicyAttachmentPageDto,
} from "@/api/dto/users/ram.dto";
import {
  diagnoseIamPolicyBodySchema,
  generateIamPolicyDraftBodySchema,
  validateIamPolicyBodySchema,
  createRamPolicyVersionBodySchema,
  setDefaultRamPolicyVersionBodySchema,
  setRamRoleTrustPolicyBodySchema,
  simulateIamPolicyBodySchema,
  ramPolicyVersionsQuerySchema,
  addRamResourceGroupMemberBodySchema,
  authorizationIdParamsSchema,
  createIamAuthorizationBodySchema,
  createRamResourceGroupBodySchema,
  iamAuthorizationQuerySchema,
  iamResourceGroupQuerySchema,
  resourceGroupIdParamsSchema,
  resourceGroupMemberParamsSchema,
} from "@/api/schema/users/ram.schema";
import {
  iamAuthorizationMiddleware,
  iamCollectionAuthorizationMiddleware,
} from "@/iam/middleware/iam-authorization.middleware";
import {
  ramAuthorizationResourceResolver,
  ramResourceGroupResourceResolver,
  ramAccountResourceResolver,
  ramRoleResourceResolver,
  ramAssumeRoleResourceResolver,
  ramUserUpdateResourceResolver,
  ramUserCreateResourceResolver,
  ramUserResourceResolver,
  iamAuthenticatedUserResourceResolver,
  ramEffectivePermissionsUserResourceResolver,
  ramPolicyResourceResolver,
  ramSessionResourceResolver,
  ramRoleUserBindingResourceResolver,
  ramRoleGroupBindingResourceResolver,
  ramPolicyBindingResourceResolver,
  ramDefaultPolicyVersionResourceResolver,
} from "@/iam/request/resource-resolvers";
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
  ramGroupPageQuerySchema,
  ramSessionPageQuerySchema,
  ramRoleBindingPageQuerySchema,
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
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { passwordEncryptionService } from "@/services/auth/password-encryption.service";

@Route("v1/ram")
@Tags("RAM")
export class RamController extends Controller {
  private ramService = RamService.getInstance();

  @Get("users/page")
  @Security("jwt")
  @Middlewares(validateQuery(iamManagementSearchPaginationSchema))
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:ram:ReadUser",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RAM_USER_READ],
    }),
  )
  public async listUsersPage(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() keyword?: string,
  ): Promise<RamUserPageDto> {
    return this.ramService.listRamUserPage(request.user!.userId, { page, pageSize, keyword });
  }

  @Get("users")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取RAM用户列表成功")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:ram:ReadUser",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RAM_USER_READ],
    }),
  )
  public async listUsers(@Request() request: TypedRequest): Promise<GetRamUsersResponse> {
    return this.ramService.listRamUsers(request.user!.userId);
  }

  @Get("groups/page")
  @Security("jwt")
  @Middlewares(validateQuery(ramGroupPageQuerySchema))
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:group:Read",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RAM_USER_READ],
    }),
  )
  public async listVisibleGroupPage(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() keyword?: string,
  ): Promise<RamVisibleGroupPageDto> {
    return this.ramService.listVisibleGroupPage(request.user!.userId, { page, pageSize, keyword });
  }

  @Get("groups")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取RAM可见用户组列表成功")
  @Middlewares(validateQuery(ramGroupListQuerySchema))
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:group:Read",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RAM_USER_READ],
    }),
  )
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
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createRamUserBodySchema),
  )
  @CheckPermission(Permission.RAM_USER_CREATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:CreateUser",
    resourceKind: "batch",
    resource: ramUserCreateResourceResolver,
  })
  public async createUser(@Body() body: CreateRamUserDto, @Request() request: TypedRequest): Promise<RamUserDto> {
    const password = passwordEncryptionService.resolvePassword(body.password, body.passwordCredential);
    return this.ramService.createRamUser(request.user!.userId, { ...body, password });
  }

  @Put("users/{userId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "更新RAM用户成功")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ramUserIdParamsSchema),
    validateBody(updateRamUserBodySchema),
  )
  @CheckPermission(Permission.RAM_USER_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:UpdateUser",
    resourceKind: "batch",
    resource: ramUserUpdateResourceResolver,
  })
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
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code", alwaysRequire: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code", alwaysRequire: true }),
    replayProtectionMiddleware,
    validateParams(ramUserIdParamsSchema),
  )
  @CheckPermission(Permission.RAM_USER_DELETE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:DeleteUser",
    resourceKind: "single-resource",
    resource: ramUserResourceResolver,
  })
  public async deleteUser(
    @Path() userId: string,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.deleteRamUser(request.user!.userId, userId);
    return { code: CustomCode.OK, message: "删除RAM用户成功" };
  }

  @Get("roles/page")
  @Security("jwt")
  @Middlewares(validateQuery(iamManagementSearchPaginationSchema))
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:ram:role:Read",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RAM_ROLE_READ],
    }),
  )
  public async listRolesPage(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() keyword?: string,
  ): Promise<RamRolePageDto> {
    return this.ramService.listRolesPage(request.user!.userId, { page, pageSize, keyword });
  }

  @Get("roles")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取RAM角色列表成功")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:ram:role:Read",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RAM_ROLE_READ],
    }),
  )
  public async listRoles(@Request() request: TypedRequest): Promise<GetRamRolesResponse> {
    return this.ramService.listRoles(request.user!.userId);
  }

  @Post("roles")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "创建RAM角色成功")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createRamRoleBodySchema),
  )
  @CheckPermission(Permission.RAM_ROLE_CREATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:role:Create",
    resourceKind: "account",
    resource: ramAccountResourceResolver,
  })
  public async createRole(@Body() body: CreateRamRoleDto, @Request() request: TypedRequest): Promise<RamRoleDto> {
    return this.ramService.createRole(request.user!.userId, body);
  }

  @Put("roles/{roleId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "更新RAM角色成功")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ramRoleIdParamsSchema),
    validateBody(updateRamRoleBodySchema),
  )
  @CheckPermission(Permission.RAM_ROLE_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:role:Update",
    resourceKind: "single-resource",
    resource: ramRoleResourceResolver,
  })
  public async updateRole(
    @Path() roleId: string,
    @Body() body: UpdateRamRoleDto,
    @Request() request: TypedRequest,
  ): Promise<RamRoleDto> {
    return this.ramService.updateRole(request.user!.userId, roleId, body);
  }

  @Put("roles/{roleId}/trust-policy")
  @Security("jwt")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ramRoleIdParamsSchema),
    validateBody(setRamRoleTrustPolicyBodySchema),
  )
  @Middlewares(
    iamAuthorizationMiddleware({
      action: "quyan:ram:UpdateRoleTrustPolicy",
      resourceKind: "single-resource",
      resource: ramRoleResourceResolver,
    }),
  )
  public async setRoleTrustPolicy(
    @Path() roleId: string,
    @Body() body: SetRamRoleTrustPolicyDto,
    @Request() request: TypedRequest,
  ): Promise<RamRoleDto> {
    return this.ramService.updateRole(request.user!.userId, roleId, {
      trustPolicy: body.document as unknown as Record<string, unknown>,
      expectedTrustPolicyHash: body.expectedDocumentHash,
    });
  }

  @Delete("roles/{roleId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "删除RAM角色成功")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code", alwaysRequire: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code", alwaysRequire: true }),
    replayProtectionMiddleware,
    validateParams(ramRoleIdParamsSchema),
  )
  @CheckPermission(Permission.RAM_ROLE_DELETE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:role:Delete",
    resourceKind: "single-resource",
    resource: ramRoleResourceResolver,
  })
  public async deleteRole(
    @Path() roleId: string,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.deleteRole(request.user!.userId, roleId);
    return { code: CustomCode.OK, message: "删除RAM角色成功" };
  }

  @Get("roles/{roleId}/bindings/page")
  @Security("jwt")
  @Middlewares(validateParams(ramRoleIdParamsSchema), validateQuery(ramRoleBindingPageQuerySchema))
  @CheckPermission(Permission.RAM_BINDING_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:binding:Read",
    resourceKind: "single-resource",
    resource: ramRoleResourceResolver,
  })
  public async listRoleBindingsPage(
    @Path() roleId: string,
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() userId?: string,
  ): Promise<RamRoleBindingPageDto> {
    return this.ramService.listRoleBindingPage(request.user!.userId, roleId, { page, pageSize, userId });
  }

  @Get("roles/{roleId}/bindings")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取RAM角色绑定成功")
  @Middlewares(validateParams(ramRoleIdParamsSchema))
  @CheckPermission(Permission.RAM_BINDING_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:binding:Read",
    resourceKind: "single-resource",
    resource: ramRoleResourceResolver,
  })
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
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ramRoleIdParamsSchema),
    validateBody(bindRamRoleToUserBodySchema),
  )
  @CheckPermission(Permission.RAM_BINDING_CREATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:binding:Create",
    resourceKind: "batch",
    resource: ramRoleUserBindingResourceResolver,
  })
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
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ramRoleIdParamsSchema.merge(ramUserIdParamsSchema)),
  )
  @CheckPermission(Permission.RAM_BINDING_DELETE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:binding:Delete",
    resourceKind: "batch",
    resource: ramRoleUserBindingResourceResolver,
  })
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
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ramRoleIdParamsSchema),
    validateBody(bindRamRoleToGroupBodySchema),
  )
  @CheckPermission(Permission.RAM_BINDING_CREATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:binding:Create",
    resourceKind: "batch",
    resource: ramRoleGroupBindingResourceResolver,
  })
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
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ramRoleIdParamsSchema.extend({ groupId: bindRamRoleToGroupBodySchema.shape.groupId })),
  )
  @CheckPermission(Permission.RAM_BINDING_DELETE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:binding:Delete",
    resourceKind: "batch",
    resource: ramRoleGroupBindingResourceResolver,
  })
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
  @CheckPermission(Permission.RAM_ASSUME_ROLE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:AssumeRole",
    resourceKind: "single-resource",
    resource: ramAssumeRoleResourceResolver,
  })
  public async assumeRole(
    @Body() body: AssumeRamRoleDto,
    @Request() request: TypedRequest,
  ): Promise<AssumeRamRoleResponseDto> {
    return this.ramService.assumeRole(request.user!.userId, body);
  }

  @Get("sessions/page")
  @Security("jwt")
  @Middlewares(validateQuery(ramSessionPageQuerySchema))
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:ram:session:Read",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RAM_SESSION_READ],
    }),
  )
  public async listSessionsPage(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() principalUserId?: string,
  ): Promise<RamRoleSessionPageDto> {
    return this.ramService.listRoleSessionPage(request.user!.userId, { page, pageSize, principalUserId });
  }

  @Get("sessions")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取RAM角色会话成功")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:ram:session:Read",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RAM_SESSION_READ],
    }),
  )
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
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ramSessionIdParamsSchema),
  )
  @CheckPermission(Permission.RAM_SESSION_REVOKE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:session:Revoke",
    resourceKind: "single-resource",
    resource: ramSessionResourceResolver,
  })
  public async revokeSession(
    @Path() sessionId: string,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.revokeRoleSession(request.user!.userId, sessionId);
    return { code: CustomCode.OK, message: "撤销RAM角色会话成功" };
  }

  // ── 权限策略 ──

  @Get("policies/page")
  @Security("jwt")
  @Middlewares(validateQuery(iamManagementSearchPaginationSchema))
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:ram:ReadPolicy",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RAM_POLICY_READ],
    }),
  )
  public async listPoliciesPage(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() keyword?: string,
  ): Promise<RamPolicyPageDto> {
    return this.ramService.listPoliciesPage(request.user!.userId, { page, pageSize, keyword });
  }

  @Get("policies")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取权限策略列表成功")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:ram:ReadPolicy",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RAM_POLICY_READ],
    }),
  )
  public async listPolicies(@Request() request: TypedRequest): Promise<GetRamPoliciesResponse> {
    return this.ramService.listPolicies(request.user!.userId);
  }

  @Post("policies")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "创建权限策略成功")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createRamPolicyBodySchema),
  )
  @CheckPermission(Permission.RAM_POLICY_CREATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:CreatePolicy",
    resourceKind: "account",
    resource: ramAccountResourceResolver,
  })
  public async createPolicy(@Body() body: CreateRamPolicyDto, @Request() request: TypedRequest): Promise<RamPolicyDto> {
    return this.ramService.createPolicy(request.user!.userId, body);
  }

  @Put("policies/{policyId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "更新权限策略成功")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ramPolicyIdParamsSchema),
    validateBody(updateRamPolicyBodySchema),
  )
  @CheckPermission(Permission.RAM_POLICY_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:UpdatePolicy",
    resourceKind: "single-resource",
    resource: ramPolicyResourceResolver,
  })
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
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code", alwaysRequire: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code", alwaysRequire: true }),
    replayProtectionMiddleware,
    validateParams(ramPolicyIdParamsSchema),
  )
  @CheckPermission(Permission.RAM_POLICY_DELETE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:DeletePolicy",
    resourceKind: "single-resource",
    resource: ramPolicyResourceResolver,
  })
  public async deletePolicy(
    @Path() policyId: string,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.deletePolicy(request.user!.userId, policyId);
    return { code: CustomCode.OK, message: "删除权限策略成功" };
  }

  @Get("policies/{policyId}/attachments/page")
  @Security("jwt")
  @Middlewares(validateParams(ramPolicyIdParamsSchema), validateQuery(iamManagementPaginationSchema))
  @CheckPermission(Permission.RAM_POLICY_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:ReadPolicy",
    resourceKind: "single-resource",
    resource: ramPolicyResourceResolver,
  })
  public async listPolicyAttachmentsPage(
    @Path() policyId: string,
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<RamPolicyAttachmentPageDto> {
    return this.ramService.listPolicyAttachmentPage(request.user!.userId, policyId, { page, pageSize });
  }

  @Get("policies/{policyId}/attachments")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取权限策略绑定列表成功")
  @Middlewares(validateParams(ramPolicyIdParamsSchema))
  @CheckPermission(Permission.RAM_POLICY_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:ReadPolicy",
    resourceKind: "single-resource",
    resource: ramPolicyResourceResolver,
  })
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
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(attachPolicyBodySchema),
  )
  @CheckPermission(Permission.RAM_POLICY_ATTACH, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:AttachPolicy",
    resourceKind: "batch",
    resource: ramPolicyBindingResourceResolver,
  })
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
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code", alwaysRequire: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code", alwaysRequire: true }),
    replayProtectionMiddleware,
    validateBody(detachPolicyBodySchema),
  )
  @CheckPermission(Permission.RAM_POLICY_DETACH, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:DetachPolicy",
    resourceKind: "batch",
    resource: ramPolicyBindingResourceResolver,
  })
  public async detachPolicy(
    @Body() body: AttachPolicyBodyDto,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.detachPolicy(request.user!.userId, body);
    return { code: CustomCode.OK, message: "解绑权限策略成功" };
  }

  @Get("authorizations/page")
  @Security("jwt")
  @Middlewares(validateQuery(iamAuthorizationQuerySchema))
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:ram:ListAuthorizations",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      alwaysEnforce: true,
    }),
  )
  public async listAuthorizationPage(
    @Request() request: TypedRequest,
    @Query() principalType?: string,
    @Query() principalId?: string,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<RamAuthorizationPageDto> {
    return this.ramService.listAuthorizationPage(request.user!.userId, { principalType, principalId, page, pageSize });
  }
  @Get("resource-groups/page")
  @Security("jwt")
  @Middlewares(validateQuery(iamManagementSearchPaginationSchema))
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:ram:ListResourceGroups",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      alwaysEnforce: true,
    }),
  )
  public async listResourceGroupPage(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() keyword?: string,
  ): Promise<RamResourceGroupPageDto> {
    return this.ramService.listResourceGroupPage(request.user!.userId, { page, pageSize, keyword });
  }
  @Get("resource-groups/{groupId}/members")
  @Security("jwt")
  @Middlewares(validateParams(resourceGroupIdParamsSchema), validateQuery(iamResourceGroupQuerySchema))
  @Middlewares(
    iamAuthorizationMiddleware({
      action: "quyan:ram:ListResourceGroups",
      resourceKind: "single-resource",
      resource: ramResourceGroupResourceResolver,
    }),
  )
  public async listResourceGroupMemberPage(
    @Path() groupId: string,
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<RamResourceGroupMemberPageDto> {
    return this.ramService.listResourceGroupMemberPage(request.user!.userId, groupId, { page, pageSize });
  }

  @Get("authorizations")
  @Security("jwt")
  @Middlewares(validateQuery(iamAuthorizationQuerySchema))
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:ram:ListAuthorizations",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      alwaysEnforce: true,
    }),
  )
  public async listAuthorizations(
    @Request() request: TypedRequest,
    @Query() principalType?: string,
    @Query() principalId?: string,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<RamAuthorizationDto[]> {
    return this.ramService.listAuthorizations(request.user!.userId, { principalType, principalId, page, pageSize });
  }

  @Post("authorizations")
  @Security("jwt")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createIamAuthorizationBodySchema),
  )
  @Middlewares(
    iamAuthorizationMiddleware({
      action: "quyan:ram:CreateAuthorization",
      resourceKind: "account",
      resource: ramAccountResourceResolver,
    }),
  )
  public async createAuthorization(
    @Body() body: CreateRamAuthorizationDto,
    @Request() request: TypedRequest,
  ): Promise<RamAuthorizationDto> {
    return this.ramService.createAuthorization(request.user!.userId, body);
  }

  @Delete("authorizations/{authorizationId}")
  @Security("jwt")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code", alwaysRequire: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code", alwaysRequire: true }),
    replayProtectionMiddleware,
    validateParams(authorizationIdParamsSchema),
  )
  @Middlewares(
    iamAuthorizationMiddleware({
      action: "quyan:ram:DeleteAuthorization",
      resourceKind: "single-resource",
      resource: ramAuthorizationResourceResolver,
    }),
  )
  public async deleteAuthorization(
    @Path() authorizationId: string,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.deleteAuthorization(request.user!.userId, authorizationId);
    return { code: CustomCode.OK, message: "删除授权关系成功" };
  }

  @Get("resource-groups")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:ram:ListResourceGroups",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      alwaysEnforce: true,
    }),
  )
  @Middlewares(validateQuery(iamResourceGroupQuerySchema))
  public async listResourceGroups(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<RamResourceGroupDto[]> {
    return this.ramService.listResourceGroups(request.user!.userId, { page, pageSize });
  }

  @Post("resource-groups")
  @Security("jwt")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createRamResourceGroupBodySchema),
  )
  @Middlewares(
    iamAuthorizationMiddleware({
      action: "quyan:ram:CreateResourceGroup",
      resourceKind: "account",
      resource: ramAccountResourceResolver,
    }),
  )
  public async createResourceGroup(
    @Body() body: CreateRamResourceGroupDto,
    @Request() request: TypedRequest,
  ): Promise<RamResourceGroupDto> {
    return this.ramService.createResourceGroup(request.user!.userId, body);
  }

  @Post("resource-groups/{groupId}/members")
  @Security("jwt")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(resourceGroupIdParamsSchema),
    validateBody(addRamResourceGroupMemberBodySchema),
  )
  @Middlewares(
    iamAuthorizationMiddleware({
      action: "quyan:ram:AddResourceGroupMember",
      resourceKind: "single-resource",
      resource: ramResourceGroupResourceResolver,
    }),
  )
  public async addResourceGroupMember(
    @Path() groupId: string,
    @Body() body: AddRamResourceGroupMemberDto,
    @Request() request: TypedRequest,
  ): Promise<RamResourceGroupDto> {
    return this.ramService.addResourceGroupMember(request.user!.userId, groupId, body);
  }

  @Delete("resource-groups/{groupId}/members/{memberId}")
  @Security("jwt")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code", alwaysRequire: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code", alwaysRequire: true }),
    replayProtectionMiddleware,
    validateParams(resourceGroupMemberParamsSchema),
  )
  @Middlewares(
    iamAuthorizationMiddleware({
      action: "quyan:ram:RemoveResourceGroupMember",
      resourceKind: "single-resource",
      resource: ramResourceGroupResourceResolver,
    }),
  )
  public async removeResourceGroupMember(
    @Path() groupId: string,
    @Path() memberId: string,
    @Request() request: TypedRequest,
  ): Promise<{ code: number; message: string }> {
    await this.ramService.removeResourceGroupMember(request.user!.userId, groupId, memberId);
    return { code: CustomCode.OK, message: "移除资源组成员成功" };
  }

  @Post("policies/delegation-check")
  @Security("jwt")
  @Middlewares(validateBody(validateIamPolicyBodySchema))
  @CheckPermission([Permission.RAM_POLICY_CREATE, Permission.RAM_POLICY_UPDATE], PermissionCheckMode.ANY, "jwt", [
    { action: "quyan:ram:CreatePolicy", resourceKind: "account", resource: ramAccountResourceResolver },
    { action: "quyan:ram:UpdatePolicy", resourceKind: "account", resource: ramAccountResourceResolver },
  ])
  public async checkPolicyDelegation(
    @Body() body: ValidateIamPolicyDto,
    @Request() request: TypedRequest,
  ): Promise<CheckIamDelegationResponseDto> {
    return this.ramService.checkPolicyDelegation(request.user!.userId, body.document);
  }

  @Post("policies/diagnose")
  @Security("jwt")
  @Middlewares(validateBody(diagnoseIamPolicyBodySchema))
  @CheckPermission([Permission.RAM_POLICY_CREATE, Permission.RAM_POLICY_UPDATE], PermissionCheckMode.ANY, "jwt", [
    { action: "quyan:ram:CreatePolicy", resourceKind: "account", resource: ramAccountResourceResolver },
    { action: "quyan:ram:UpdatePolicy", resourceKind: "account", resource: ramAccountResourceResolver },
  ])
  public async diagnosePolicy(
    @Body() body: DiagnoseIamPolicyDto,
    @Request() request: TypedRequest,
  ): Promise<DiagnoseIamPolicyResponseDto> {
    return this.ramService.diagnosePolicy(request.user!.userId, body.documentText, body.policyKind);
  }

  @Post("policies/ai/draft")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(generateIamPolicyDraftBodySchema))
  @Middlewares(
    iamAuthorizationMiddleware({
      action: "quyan:ram:GeneratePolicyDraft",
      resourceKind: "account",
      resource: ramAccountResourceResolver,
    }),
  )
  public async generatePolicyDraft(
    @Body() body: GenerateIamPolicyDraftDto,
    @Request() request: TypedRequest,
  ): Promise<GenerateIamPolicyDraftResponseDto> {
    const abortController = new AbortController();
    const abortIfDisconnected = () => {
      if (!request.res?.writableEnded) abortController.abort();
    };
    request.once("aborted", abortIfDisconnected);
    request.res?.once("close", abortIfDisconnected);
    try {
      return await this.ramService.generatePolicyDraft(request.user!.userId, body, {
        ipAddress: request.ip,
        requestId: request.res?.locals.requestId,
        signal: abortController.signal,
      });
    } finally {
      request.off("aborted", abortIfDisconnected);
      request.res?.off("close", abortIfDisconnected);
    }
  }

  @Post("policies/validate")
  @Security("jwt")
  @Middlewares(validateBody(validateIamPolicyBodySchema))
  @CheckPermission([Permission.RAM_POLICY_CREATE, Permission.RAM_POLICY_UPDATE], PermissionCheckMode.ANY, "jwt", [
    { action: "quyan:ram:CreatePolicy", resourceKind: "account", resource: ramAccountResourceResolver },
    { action: "quyan:ram:UpdatePolicy", resourceKind: "account", resource: ramAccountResourceResolver },
  ])
  public async validatePolicy(@Body() body: ValidateIamPolicyDto): Promise<ValidateIamPolicyResponseDto> {
    return this.ramService.validatePolicy(body.document);
  }

  @Post("policies/simulate")
  @Security("jwt")
  @Middlewares(
    validateBody(simulateIamPolicyBodySchema),
    iamAuthorizationMiddleware({
      action: "quyan:iam:SimulatePolicy",
      resourceKind: "account",
      resource: ramAccountResourceResolver,
    }),
  )
  public async simulatePolicy(
    @Body() body: SimulateIamPolicyDto,
    @Request() request: TypedRequest,
  ): Promise<SimulateIamPolicyResponseDto> {
    return this.ramService.simulatePolicy(
      request.user!.userId,
      body.principalId,
      body.action,
      body.resource,
      body.documentText,
    );
  }

  @Get("policies/{policyId}/versions")
  @Security("jwt")
  @Middlewares(validateParams(ramPolicyIdParamsSchema), validateQuery(ramPolicyVersionsQuerySchema))
  @CheckPermission(Permission.RAM_POLICY_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:ReadPolicy",
    resourceKind: "single-resource",
    resource: ramPolicyResourceResolver,
  })
  public async listPolicyVersions(
    @Path() policyId: string,
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<RamPolicyVersionPageDto> {
    return this.ramService.listPolicyVersions(request.user!.userId, policyId, { page, pageSize });
  }

  @Post("policies/{policyId}/versions")
  @Security("jwt")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ramPolicyIdParamsSchema),
    validateBody(createRamPolicyVersionBodySchema),
  )
  @CheckPermission(Permission.RAM_POLICY_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:UpdatePolicy",
    resourceKind: "single-resource",
    resource: ramPolicyResourceResolver,
  })
  public async createPolicyVersion(
    @Path() policyId: string,
    @Body() body: CreateRamPolicyVersionDto,
    @Request() request: TypedRequest,
  ): Promise<RamPolicyDto> {
    return this.ramService.updatePolicy(request.user!.userId, policyId, body);
  }

  @Put("policies/{policyId}/default-version")
  @Security("jwt")
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code", alwaysRequire: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code", alwaysRequire: true }),
    replayProtectionMiddleware,
    validateParams(ramPolicyIdParamsSchema),
    validateBody(setDefaultRamPolicyVersionBodySchema),
  )
  @CheckPermission(Permission.RAM_POLICY_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:UpdatePolicy",
    resourceKind: "batch",
    resource: ramDefaultPolicyVersionResourceResolver,
  })
  public async setDefaultPolicyVersion(
    @Path() policyId: string,
    @Body() body: SetDefaultRamPolicyVersionDto,
    @Request() request: TypedRequest,
  ): Promise<void> {
    return this.ramService.setDefaultPolicyVersion(
      request.user!.userId,
      policyId,
      body.versionId,
      body.expectedDocumentHash,
    );
  }

  @Get("iam/actions")
  @Security("jwt")
  @CheckPermission(Permission.RAM_POLICY_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:iam:GetCatalog",
    resourceKind: "single-resource",
    resource: iamAuthenticatedUserResourceResolver,
  })
  public async getIamActions(): Promise<string[]> {
    return [...this.ramService.getIamActionCatalog()];
  }

  // ── 授权概览 ──

  @Get("authorization/effective-permissions")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "获取用户有效权限成功")
  @Middlewares(validateQuery(authorizationQuerySchema))
  @CheckPermission(Permission.RAM_USER_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:ReadUser",
    resourceKind: "single-resource",
    resource: ramEffectivePermissionsUserResourceResolver,
  })
  public async getUserEffectivePermissions(
    @Request() request: TypedRequest,
    @Query() userId: string,
  ): Promise<EffectivePermissionDto> {
    return this.ramService.getUserEffectivePermissions(request.user!.userId, userId);
  }
}
