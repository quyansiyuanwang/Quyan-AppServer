import { checkIamDelegation } from "@/iam/delegation/delegation-check";
import { projectScopedPolicyForDelegation } from "@/iam/delegation/scoped-policy";
import { legacyPermissionsToPolicy } from "@/iam/legacy-policy";
import { principalConditionContext } from "@/iam/request/condition-context";
import { accountEntityResourceResolver } from "@/iam/request/resource-resolvers";
import type { TypedRequest } from "@/types/express";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { getRequestContext } from "@/util/request-context";
import { actionForPermission, buildAcsResource } from "@quyan/shared";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { Permission } from "@/constant/permission";
import { PermissionList, UserPermissionConfig, UserFullPermissions, PermissionCheckResult } from "@/models/permission";
import { BadRequestError, ForbiddenError, ConflictError, UnauthorizedError } from "@/util/errors";
import { isValidPermission } from "@/util/permission/validation";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { UserRepository } from "@/store/users/user.repository";
import { GroupRepository } from "@/store/users/group.repository";
import { RamRoleRepository } from "@/store/users/ram-role.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { env } from "@/config/env";
import type { UserStore, UserWithGroup, UserPermissionSnapshot } from "@/store/users/user.store";
import type { GroupStore, GroupPermissionSnapshot } from "@/store/users/group.store";
import type { RamRoleStore } from "@/store/users/ram-role.store";
import type { RamPolicyStore } from "@/store/users/ram-policy.store";
import type { Request } from "express";
import { extractClientIp } from "@/util/ip-extractor";

type UserPermissionEntity = Pick<UserWithGroup, "id" | "permissionAdds" | "permissionRemoves">;
type GroupPermissionEntity = { permissions: unknown };

interface PermissionCalculationOptions {
  assumedRoleSessionId?: string;
}

/**
 * 权限服务
 * 负责处理用户权限的计算、验证和管理
 */
export class PermissionService {
  private static instance: PermissionService | null = null;
  private constructor(
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly groupRepository: GroupStore = GroupRepository.getInstance(),
    private readonly ramRoleRepository: RamRoleStore = RamRoleRepository.getInstance(),
    private readonly ramPolicyRepository: RamPolicyStore = RamPolicyRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
  ) {}

  static getInstance() {
    if (!this.instance) this.instance = new PermissionService();

    return this.instance;
  }

  /**
   * 获取客户端 IP 地址
   */
  private getClientIP(req?: Request): string {
    if (!req) return "unknown";
    return extractClientIp(req);
  }

  /**
   * 验证权限列表是否有效
   * @param permissions 权限列表
   * @throws BadRequestError 如果包含无效权限
   */
  validatePermissions(permissions: string[]): void {
    const invalidPermissions = permissions.filter((p) => !isValidPermission(p));
    if (invalidPermissions.length > 0)
      throw new BadRequestError(`无效的权限: ${invalidPermissions.join(", ")}`, undefined, {
        messageKey: "permission.invalidPermissions",
        messageParams: { permissions: invalidPermissions.join(", ") },
      });
  }

  /**
   * 验证操作者只能授予自己已拥有的权限
   * @param operatorUserId 操作者用户ID
   * @param permissions 计划授予/保留的权限列表
   * @throws ForbiddenError 如果包含操作者没有的权限
   */
  async assertCanGrantPermissions(operatorUserId: string, permissions: Permission[]): Promise<void> {
    this.validatePermissions(permissions);

    const operatorUser = await this.userRepository.findById(operatorUserId);
    if (!operatorUser)
      throw new BadRequestError("操作者用户不存在", undefined, { messageKey: "permission.operatorNotFound" });

    if (env.security.iamAuthorizationMode === "enforce") {
      const owner = operatorUser.accountOwnerId || operatorUser.id;
      const request = getRequestContext();
      const principal = request
        ? getIamPrincipal(request)
        : {
            subjectUserId: operatorUser.id,
            principalUserId: operatorUser.id,
            accountOwnerId: owner,
            subjectType: operatorUser.id === owner ? ("root" as const) : ("sub_user" as const),
          };
      if (!principal || principal.principalUserId !== operatorUser.id || principal.accountOwnerId !== owner)
        throw new ForbiddenError("Invalid legacy delegation context", undefined, {
          messageKey: "iam.delegationDenied",
        });
      if (principal.subjectType === "root" && operatorUser.userType === "root" && operatorUser.id === owner) return;
      const candidate = legacyPermissionsToPolicy(permissions, owner);
      if (!candidate) return;
      const grants = await IamAuthorizationService.getInstance().loadPolicies(principal);
      const result = checkIamDelegation(
        candidate,
        grants.flatMap((policy) => {
          const projected = projectScopedPolicyForDelegation(policy);
          return projected ? [projected] : [];
        }),
      );
      if (!result.allowed)
        throw new ForbiddenError("Legacy permission exceeds current IAM scope", undefined, {
          messageKey: "iam.delegationDenied",
        });
      return;
    }

    if (operatorUser.groupId) {
      const operatorGroup = await this.groupRepository.findById(operatorUser.groupId);
      if (operatorGroup?.username === env.security.superAdminGroupUsername) return;
    }

    const operatorPermissions = await this.getUserFullPermissions(operatorUserId);
    if (!operatorPermissions)
      throw new BadRequestError("操作者用户不存在", undefined, { messageKey: "permission.operatorNotFound" });

    const grantablePermissions = new Set(operatorPermissions.effectivePermissions);
    const forbiddenPermissions = permissions.filter((permission) => !grantablePermissions.has(permission));
    if (forbiddenPermissions.length > 0)
      throw new ForbiddenError(`不能授予自己未拥有的权限: ${forbiddenPermissions.join(", ")}`, undefined, {
        messageKey: "permission.cannotGrantUnownedPermissions",
        messageParams: { permissions: forbiddenPermissions.join(", ") },
      });
  }

  /**
   * 解析JSON权限数据
   * @param jsonData JSON数据（可能是字符串或已解析的对象）
   * @returns 权限列表
   */
  parsePermissionJson(jsonData: any): PermissionList {
    // 如果已经是数组，直接使用
    if (Array.isArray(jsonData))
      return jsonData.filter((item) => typeof item === "string" && isValidPermission(item)) as PermissionList;

    // 如果是字符串，尝试解析
    if (typeof jsonData === "string")
      try {
        const parsed = JSON.parse(jsonData);
        if (Array.isArray(parsed))
          return parsed.filter((item) => typeof item === "string" && isValidPermission(item)) as PermissionList;
      } catch {
        return [];
      }

    return [];
  }

  /**
   * 计算用户的最终有效权限
   * @param user 用户对象
   * @param group 用户组对象
   * @returns 用户完整权限信息
   */
  calculateUserPermissions(
    user: UserPermissionEntity & { groupId?: string | null; accountOwnerId?: string | null },
    group: GroupPermissionEntity | null,
  ): UserFullPermissions {
    // 解析用户组权限
    const groupPermissions = group ? this.parsePermissionJson(group.permissions) : [];

    // 解析用户额外添加的权限
    const additionalPermissions = this.parsePermissionJson(user.permissionAdds);

    // 解析用户移除的权限
    const removedPermissions = this.parsePermissionJson(user.permissionRemoves);

    // 计算最终有效权限：(用户组权限 + 额外权限) - 移除权限
    const effectivePermissionsSet = new Set<Permission>([...groupPermissions, ...additionalPermissions]);

    // 移除被标记为移除的权限
    removedPermissions.forEach((p) => effectivePermissionsSet.delete(p));

    const effectivePermissions = Array.from(effectivePermissionsSet);

    return {
      userId: user.id,
      accountOwnerId: user.accountOwnerId || user.id,
      groupPermissions,
      additionalPermissions,
      removedPermissions,
      effectivePermissions,
    };
  }

  async calculateUserPermissionsWithRoles(
    user: UserPermissionEntity & { groupId?: string | null; accountOwnerId?: string | null },
    group: GroupPermissionEntity | null,
    options: PermissionCalculationOptions = {},
  ): Promise<UserFullPermissions> {
    const basePermissions = this.calculateUserPermissions(user, group);
    const roleBindings = await this.ramRoleRepository.listRoleBindingsForUser(user.id, user.groupId ?? null);
    const rolePermissions = roleBindings.flatMap((binding) =>
      binding.permissions.filter((permission): permission is Permission => isValidPermission(permission)),
    );

    // RamPolicy 权限: 用户级 + 用户组级策略
    const userPolicyBindings = await this.ramPolicyRepository.listPoliciesForTarget("user", user.id);
    const policyPermissions: Permission[] = [
      ...new Set(
        userPolicyBindings.flatMap((b) =>
          b.permissions.filter((permission): permission is Permission => isValidPermission(permission)),
        ),
      ),
    ];
    if (user.groupId) {
      const groupPolicyBindings = await this.ramPolicyRepository.listPoliciesForTarget("group", user.groupId);
      policyPermissions.push(
        ...groupPolicyBindings.flatMap((b) =>
          b.permissions.filter((permission): permission is Permission => isValidPermission(permission)),
        ),
      );
    }

    let assumedRolePermissions: Permission[] = [];
    let assumedRole: UserFullPermissions["assumedRole"];
    if (options.assumedRoleSessionId) {
      const session = await this.ramRoleRepository.findActiveRoleSession(options.assumedRoleSessionId);
      if (session && session.subjectUserId === user.id) {
        const rolePolicies = await this.ramPolicyRepository.listPoliciesForTarget("role", session.roleId);
        assumedRolePermissions = rolePolicies.flatMap((b) =>
          b.permissions.filter((permission): permission is Permission => isValidPermission(permission)),
        );
        assumedRole = { id: session.roleId, name: session.role.name, sessionId: session.id };
      }
    }

    const effectivePermissionsSet = new Set<Permission>([
      ...basePermissions.effectivePermissions,
      ...rolePermissions,
      ...assumedRolePermissions,
      ...policyPermissions,
    ]);
    basePermissions.removedPermissions.forEach((p) => effectivePermissionsSet.delete(p));

    return {
      ...basePermissions,
      rolePermissions,
      assumedRolePermissions,
      policyPermissions,
      roles: roleBindings.map((binding) => ({ id: binding.roleId, name: binding.roleName, source: binding.source })),
      assumedRole,
      effectivePermissions: Array.from(effectivePermissionsSet),
    };
  }

  /** Self inspection is a baseline; inspecting another identity requires its exact IAM resource. */
  async canReadUserPermissionQuery(request: TypedRequest, userId: string): Promise<boolean> {
    const currentUserId = request.user?.userId;
    if (!currentUserId)
      throw new UnauthorizedError("Permission query identity missing", undefined, {
        messageKey: "permission.loginRequired",
      });
    if (env.security.iamAuthorizationMode !== "enforce")
      return currentUserId === userId || this.hasPermission(currentUserId, Permission.PERMISSION_VIEW);
    const principal = getIamPrincipal(request);
    if (!principal)
      throw new UnauthorizedError("Permission query principal missing", undefined, {
        messageKey: "permission.loginRequired",
      });
    const target = await this.userRepository.findById(userId);
    if (!target || target.status !== 1 || (target.accountOwnerId || target.id) !== principal.accountOwnerId)
      return false;
    const { authorizeLegacyPermissions } = await import("@/iam/middleware/legacy-permission-bridge");
    return authorizeLegacyPermissions(request, [Permission.PERMISSION_VIEW], false, {
      action: actionForPermission(Permission.PERMISSION_VIEW),
      resourceKind: "single-resource",
      resource: accountEntityResourceResolver("user", () => userId),
    });
  }

  /**
   * 获取用户的完整权限信息
   * @param userId 用户ID
   * @returns 用户完整权限信息
   */
  async getUserFullPermissions(
    userId: string,
    options: PermissionCalculationOptions = {},
  ): Promise<UserFullPermissions | null> {
    const user = await this.userRepository.findByIdWithGroup(userId);

    if (!user) return null;

    const request = getRequestContext();
    const currentPrincipal =
      env.security.iamAuthorizationMode === "enforce" && request?.user?.userId === user.id
        ? getIamPrincipal(request)
        : undefined;
    if (currentPrincipal?.roleSessionId && !options.assumedRoleSessionId)
      options = { ...options, assumedRoleSessionId: currentPrincipal.roleSessionId };
    const legacy = await this.calculateUserPermissionsWithRoles(user, user.group, options);
    if (env.security.iamAuthorizationMode !== "enforce") return legacy;
    const session = options.assumedRoleSessionId
      ? await this.ramRoleRepository.findActiveRoleSession(options.assumedRoleSessionId)
      : undefined;
    const accountOwnerId = user.accountOwnerId || user.id;
    const principal = currentPrincipal ?? {
      subjectUserId: user.id,
      principalUserId: user.id,
      accountOwnerId,
      subjectType: session
        ? ("assumed_role" as const)
        : user.id === accountOwnerId
          ? ("root" as const)
          : ("sub_user" as const),
      assumedRoleId: session?.roleId,
      roleSessionId: options.assumedRoleSessionId,
    };
    if (options.assumedRoleSessionId && principal.roleSessionId !== options.assumedRoleSessionId)
      throw new ForbiddenError("IAM projection session mismatch", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    const policies = await IamAuthorizationService.getInstance().loadPolicies(principal);
    const context = principalConditionContext(principal);
    const resource = buildAcsResource({ service: "quyan", region: "*", accountId: accountOwnerId, path: "account" });
    const effectivePermissions = Object.values(Permission).filter(
      (permission) =>
        evaluatePolicies(policies, { action: actionForPermission(permission), resource, context }).decision === "Allow",
    );
    return { ...legacy, effectivePermissions };
  }

  /**
   * 检查用户是否拥有指定权限
   * @param userId 用户ID
   * @param requiredPermissions 需要的权限列表
   * @returns 权限检查结果
   */
  async checkUserPermissions(
    userId: string,
    requiredPermissions: Permission[],
    options: PermissionCalculationOptions = {},
  ): Promise<PermissionCheckResult> {
    const userPermissions = await this.getUserFullPermissions(userId, options);

    if (!userPermissions)
      return {
        hasPermission: false,
        missingPermissions: requiredPermissions,
        checkedPermissions: requiredPermissions,
      };

    const effectivePermissionsSet = new Set(userPermissions.effectivePermissions);
    const missingPermissions = requiredPermissions.filter((p) => !effectivePermissionsSet.has(p));

    return {
      hasPermission: missingPermissions.length === 0,
      missingPermissions: missingPermissions.length > 0 ? missingPermissions : undefined,
      checkedPermissions: requiredPermissions,
    };
  }

  /**
   * 检查用户是否拥有任一指定权限
   * @param userId 用户ID
   * @param permissions 权限列表
   * @returns 是否拥有任一权限
   */
  async hasAnyPermission(userId: string, permissions: Permission[]): Promise<boolean> {
    const userPermissions = await this.getUserFullPermissions(userId);
    if (!userPermissions) return false;

    const effectivePermissionsSet = new Set(userPermissions.effectivePermissions);
    return permissions.some((p) => effectivePermissionsSet.has(p));
  }

  /**
   * 检查用户是否拥有全部指定权限
   * @param userId 用户ID
   * @param permissions 权限列表
   * @returns 是否拥有全部权限
   */
  async hasAllPermissions(userId: string, permissions: Permission[]): Promise<boolean> {
    const userPermissions = await this.getUserFullPermissions(userId);
    if (!userPermissions) return false;

    const effectivePermissionsSet = new Set(userPermissions.effectivePermissions);
    return permissions.every((p) => effectivePermissionsSet.has(p));
  }

  /**
   * 检查用户是否拥有指定权限
   * @param userId 用户ID
   * @param permission 需要的权限
   * @returns 是否拥有该权限
   */
  async hasPermission(userId: string, permission: Permission): Promise<boolean> {
    return this.hasAllPermissions(userId, [permission]);
  }

  /**
   * 检查操作者是否可以修改目标用户的权限
   * 规则：
   * 1. 不能修改自己的权限
   * 2. 不能修改组等级大于或等于自己的用户的权限
   * @param operatorUserId 操作者用户ID
   * @param targetUserId 目标用户ID
   * @throws ForbiddenError 如果不允许修改
   */
  async canModifyUserPermissions(
    operatorUserId: string,
    targetUserId: string,
  ): Promise<{ operator: UserWithGroup; user: UserWithGroup }> {
    // 检查是否修改自己的权限
    if (operatorUserId === targetUserId)
      throw new ForbiddenError("不允许修改自己的权限", undefined, { messageKey: "permission.cannotModifySelf" });

    // 获取操作者和目标用户的信息
    const [operator, target] = await Promise.all([
      this.userRepository.findByIdWithGroup(operatorUserId),
      this.userRepository.findByIdWithGroup(targetUserId),
    ]);

    if (!operator)
      throw new BadRequestError("操作者用户不存在", undefined, { messageKey: "permission.operatorNotFound" });
    if (!target)
      throw new BadRequestError("目标用户不存在", undefined, { messageKey: "permission.targetUserNotFound" });

    if (env.security.iamAuthorizationMode === "enforce") {
      const owner = operator.accountOwnerId || operator.id;
      if ((target.accountOwnerId || target.id) !== owner || (target.id === owner && operator.id !== owner))
        throw new ForbiddenError("Legacy permission target crosses account or recovery scope", undefined, {
          messageKey: "iam.delegationDenied",
        });
    }

    // 检查组等级：level越高权限越低，不能修改level小于或等于自己的用户（权限大于或等于自己）
    if ((target.group?.level ?? Infinity) <= (operator.group?.level ?? -1))
      throw new ForbiddenError("无权修改等级大于或等于自己的用户的权限", undefined, {
        messageKey: "permission.cannotModifyPeer",
      });
    return { operator, user: target };
  }

  /**
   * 添加用户的额外权限
   * @param operatorUserId 操作者用户ID
   * @param userId 用户ID
   * @param permissions 要添加的权限列表
   * @param request Express 请求对象（可选）
   */
  async addUserPermissions(
    operatorUserId: string,
    userId: string,
    permissions: Permission[],
    request?: Request,
  ): Promise<void> {
    this.validatePermissions(permissions);
    await this.assertCanGrantPermissions(operatorUserId, permissions);

    // 安全检查：检查是否可以修改目标用户的权限
    const { user, operator } = await this.canModifyUserPermissions(operatorUserId, userId);

    const currentAdds = this.parsePermissionJson(user.permissionAdds);
    const updatedAdds = Array.from(new Set([...currentAdds, ...permissions]));

    await this.commitUserPermissionSnapshot(user, {
      permissionAdds: updatedAdds,
    });

    // 记录业务日志
    await this.businessLogService.logOperation({
      operationType: OperationType.PERMISSION_GRANT,
      operationCategory: OperationCategory.PERMISSION,
      actorUserId: operatorUserId,
      targetUserId: userId,
      targetResourceType: "USER",
      description: `用户 '${operator.username}' 为用户 '${user.username}' 添加权限: [${permissions.join(", ")}]`,
      changes: {
        before: { permissionAdds: currentAdds },
        after: { permissionAdds: updatedAdds },
      },
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });
  }

  /**
   * 移除用户的权限（添加到移除列表）
   * @param operatorUserId 操作者用户ID
   * @param userId 用户ID
   * @param permissions 要移除的权限列表
   * @param request Express 请求对象（可选）
   */
  async removeUserPermissions(
    operatorUserId: string,
    userId: string,
    permissions: Permission[],
    request?: Request,
  ): Promise<void> {
    this.validatePermissions(permissions);

    // 安全检查：检查是否可以修改目标用户的权限
    const { user, operator } = await this.canModifyUserPermissions(operatorUserId, userId);

    const currentRemoves = this.parsePermissionJson(user.permissionRemoves);
    const updatedRemoves = Array.from(new Set([...currentRemoves, ...permissions]));

    await this.commitUserPermissionSnapshot(user, {
      permissionRemoves: updatedRemoves,
    });

    // 记录业务日志
    await this.businessLogService.logOperation({
      operationType: OperationType.PERMISSION_REVOKE,
      operationCategory: OperationCategory.PERMISSION,
      actorUserId: operatorUserId,
      targetUserId: userId,
      targetResourceType: "USER",
      description: `用户 '${operator.username}' 移除用户 '${user.username}' 的权限: [${permissions.join(", ")}]`,
      changes: {
        before: { permissionRemoves: currentRemoves },
        after: { permissionRemoves: updatedRemoves },
      },
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });
  }

  /**
   * 设置用户的权限配置
   * @param operatorUserId 操作者用户ID
   * @param userId 用户ID
   * @param config 权限配置
   * @param request Express 请求对象（可选）
   */
  async setUserPermissionConfig(
    operatorUserId: string,
    userId: string,
    config: Partial<UserPermissionConfig>,
    request?: Request,
  ): Promise<void> {
    // 安全检查：检查是否可以修改目标用户的权限
    const { user, operator } = await this.canModifyUserPermissions(operatorUserId, userId);

    const beforeAdds = this.parsePermissionJson(user.permissionAdds);
    const beforeRemoves = this.parsePermissionJson(user.permissionRemoves);

    const updateData: any = {};
    const hasPermissionAdds = Object.prototype.hasOwnProperty.call(config, "permissionAdds");
    const hasPermissionRemoves = Object.prototype.hasOwnProperty.call(config, "permissionRemoves");

    if (hasPermissionAdds) {
      const permissionAdds = config.permissionAdds ?? [];
      this.validatePermissions(permissionAdds);
      await this.assertCanGrantPermissions(operatorUserId, permissionAdds);
      updateData.permissionAdds = Array.from(new Set(permissionAdds));
    }

    if (hasPermissionRemoves) {
      const permissionRemoves = config.permissionRemoves ?? [];
      this.validatePermissions(permissionRemoves);
      if (env.security.iamAuthorizationMode === "enforce") {
        const retainedDenies = new Set(permissionRemoves);
        await this.assertCanGrantPermissions(
          operatorUserId,
          beforeRemoves.filter((permission) => !retainedDenies.has(permission)),
        );
      }
      updateData.permissionRemoves = Array.from(new Set(permissionRemoves));
    }

    if (env.security.iamAuthorizationMode === "enforce") {
      const authenticatedRequest = (request ?? getRequestContext()) as TypedRequest | undefined;
      if (authenticatedRequest) {
        const principal = getIamPrincipal(authenticatedRequest);
        if (!principal || principal.principalUserId !== operatorUserId || principal.subjectUserId !== operatorUserId)
          throw new ForbiddenError("Permission configuration actor does not match authentication", undefined, {
            messageKey: "permission.insufficientPermission",
          });
        const afterAdds = new Set<Permission>(updateData.permissionAdds ?? beforeAdds);
        const afterRemoves = new Set<Permission>(updateData.permissionRemoves ?? beforeRemoves);
        const previousAdds = new Set(beforeAdds),
          previousRemoves = new Set(beforeRemoves);
        const restoresAccess =
          [...afterAdds].some((permission) => !previousAdds.has(permission)) ||
          beforeRemoves.some((permission) => !afterRemoves.has(permission));
        const reducesAccess =
          beforeAdds.some((permission) => !afterAdds.has(permission)) ||
          [...afterRemoves].some((permission) => !previousRemoves.has(permission));
        const required = [
          ...(restoresAccess ? [Permission.PERMISSION_ADD] : []),
          ...(reducesAccess ? [Permission.PERMISSION_REMOVE] : []),
        ];
        if (required.length) {
          const { authorizeLegacyPermissions } = await import("@/iam/middleware/legacy-permission-bridge");
          const resource = accountEntityResourceResolver("user", () => userId);
          if (
            !(await authorizeLegacyPermissions(
              authenticatedRequest,
              required,
              false,
              required.map((permission) => ({
                action: actionForPermission(permission),
                resourceKind: "single-resource" as const,
                resource,
              })),
            ))
          )
            throw new ForbiddenError("Permission configuration mutation action denied", undefined, {
              messageKey: "permission.insufficientPermission",
            });
        }
      }
    }

    await this.commitUserPermissionSnapshot(user, updateData);

    // 记录业务日志
    const changes: any = { before: {}, after: {} };
    if (hasPermissionAdds) {
      changes.before.permissionAdds = beforeAdds;
      changes.after.permissionAdds = updateData.permissionAdds;
    }
    if (hasPermissionRemoves) {
      changes.before.permissionRemoves = beforeRemoves;
      changes.after.permissionRemoves = updateData.permissionRemoves;
    }

    await this.businessLogService.logOperation({
      operationType: OperationType.PERMISSION_GRANT,
      operationCategory: OperationCategory.PERMISSION,
      actorUserId: operatorUserId,
      targetUserId: userId,
      targetResourceType: "USER",
      description: `用户 '${operator.username}' 更新了用户 '${user.username}' 的权限配置`,
      changes,
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });
  }

  /**
   * 清空用户的额外权限配置
   * @param operatorUserId 操作者用户ID
   * @param userId 用户ID
   * @param request Express 请求对象（可选）
   */
  async clearUserPermissionConfig(operatorUserId: string, userId: string, request?: Request): Promise<void> {
    // 安全检查：检查是否可以修改目标用户的权限
    const { user, operator } = await this.canModifyUserPermissions(operatorUserId, userId);

    const beforeAdds = this.parsePermissionJson(user.permissionAdds);
    const beforeRemoves = this.parsePermissionJson(user.permissionRemoves);

    if (env.security.iamAuthorizationMode === "enforce")
      await this.assertCanGrantPermissions(operatorUserId, beforeRemoves);
    await this.commitUserPermissionSnapshot(user, {
      permissionAdds: [],
      permissionRemoves: [],
    });

    // 记录业务日志
    await this.businessLogService.logOperation({
      operationType: OperationType.PERMISSION_CLEAR,
      operationCategory: OperationCategory.PERMISSION,
      actorUserId: operatorUserId,
      targetUserId: userId,
      targetResourceType: "USER",
      description: `用户 '${operator.username}' 清空了用户 '${user.username}' 的额外权限配置`,
      changes: {
        before: { permissionAdds: beforeAdds, permissionRemoves: beforeRemoves },
        after: { permissionAdds: [], permissionRemoves: [] },
      },
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });
  }

  private async commitUserPermissionSnapshot(
    expected: UserPermissionSnapshot,
    data: { permissionAdds?: string[]; permissionRemoves?: string[] },
  ): Promise<void> {
    if (!(await this.userRepository.compareAndSetPermissions(expected, data)))
      throw new ConflictError("Permission state changed after authorization", undefined, {
        messageKey: "iam.versionConflict",
      });
  }

  /** Legacy unowned recovery groups are visible only to their real account owner. */
  private async assertGroupPermissionAccountScope(
    group: { id: string; username: string; accountOwnerId: string | null },
    operatorUserId: string,
  ): Promise<void> {
    if (env.security.iamAuthorizationMode !== "enforce") return;
    const operator = await this.userRepository.findById(operatorUserId);
    const owner = operator?.accountOwnerId || operator?.id;
    const request = getRequestContext();
    const principal = request ? getIamPrincipal(request) : undefined;
    const recovery =
      operator?.userType === "root" &&
      operator.id === owner &&
      (!request ||
        (principal?.subjectType === "root" &&
          principal.principalUserId === operator.id &&
          principal.accountOwnerId === owner)) &&
      operator.groupId === group.id &&
      group.accountOwnerId === null &&
      group.username === env.security.superAdminGroupUsername;
    if (!owner || (!recovery && group.accountOwnerId !== owner))
      throw new ForbiddenError("Legacy group permission target crosses account scope", undefined, {
        messageKey: "iam.delegationDenied",
      });
  }

  /**
   * 获取用户组的权限列表
   * @param groupId 用户组ID
   * @returns 权限列表
   */
  async getGroupPermissions(groupId: string, operatorUserId?: string): Promise<PermissionList> {
    const group = await this.groupRepository.findById(groupId);

    if (!group) return [];
    if (operatorUserId) await this.assertGroupPermissionAccountScope(group, operatorUserId);

    return this.parsePermissionJson(group.permissions);
  }

  /**
   * 设置用户组的权限列表
   * @param groupId 用户组ID
   * @param permissions 权限列表
   * @param operatorUserId 操作者用户ID（可选，用于日志记录）
   * @param request Express 请求对象（可选）
   */
  async setGroupPermissions(
    groupId: string,
    permissions: Permission[],
    operatorUserId?: string,
    request?: Request,
    expected?: GroupPermissionSnapshot,
  ): Promise<void> {
    this.validatePermissions(permissions);
    if (operatorUserId) await this.assertCanGrantPermissions(operatorUserId, permissions);

    // Controllers pass the exact snapshot used for their hierarchy and Add/Remove checks.
    const group = expected ?? (await this.groupRepository.findById(groupId));
    if (group && group.id !== groupId)
      throw new ConflictError("Group permission snapshot does not match target", undefined, {
        messageKey: "iam.versionConflict",
      });
    if (!group) throw new BadRequestError("用户组不存在", undefined, { messageKey: "permission.groupNotFound" });

    if (operatorUserId) await this.assertGroupPermissionAccountScope(group, operatorUserId);

    const beforePermissions = this.parsePermissionJson(group.permissions);
    const afterPermissions = Array.from(new Set(permissions));

    if (!(await this.groupRepository.compareAndSetPermissions(group, afterPermissions)))
      throw new ConflictError("Group permission state changed after authorization", undefined, {
        messageKey: "iam.versionConflict",
      });

    // 记录业务日志（如果提供了操作者ID）
    if (operatorUserId) {
      const operator = await this.userRepository.findById(operatorUserId);

      await this.businessLogService.logOperation({
        operationType: OperationType.GROUP_PERMISSION_UPDATE,
        operationCategory: OperationCategory.GROUP_MANAGEMENT,
        actorUserId: operatorUserId,
        targetResourceId: groupId,
        targetResourceType: "GROUP",
        description: `用户 '${operator?.username || operatorUserId}' 更新了用户组 '${group.name}' 的权限`,
        changes: {
          before: { permissions: beforePermissions },
          after: { permissions: afterPermissions },
        },
        success: true,
        ipAddress: this.getClientIP(request),
        userAgent: request?.headers["user-agent"],
        requestId: request?.headers["x-request-id"] as string | undefined,
      });
    }
  }

  /**
   * 获取用户的完整权限信息
   * @param userId 用户ID
   * @returns 用户完整权限信息
   */
  async getUserPermissions(userId: string): Promise<UserFullPermissions | null> {
    return permissionService.getUserFullPermissions(userId);
  }
}

export const permissionService = PermissionService.getInstance();
