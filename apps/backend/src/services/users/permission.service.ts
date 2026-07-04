import { Permission } from "@/constant/permission";
import { PermissionList, UserPermissionConfig, UserFullPermissions, PermissionCheckResult } from "@/models/permission";
import { BadRequestError, ForbiddenError } from "@/util/errors";
import { isValidPermission } from "@/util/permission/validation";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { UserRepository } from "@/store/users/user.repository";
import { GroupRepository } from "@/store/users/group.repository";
import { RamRoleRepository } from "@/store/users/ram-role.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { UserStore, UserWithGroup } from "@/store/users/user.store";
import type { GroupStore } from "@/store/users/group.store";
import type { RamRoleStore } from "@/store/users/ram-role.store";
import type { RamPolicyStore } from "@/store/users/ram-policy.store";
import type { Request } from "express";

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
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return typeof forwarded === "string" ? forwarded.split(",")[0].trim() : forwarded[0];
    return req.ip || req.socket.remoteAddress || "unknown";
  }

  /**
   * 验证权限列表是否有效
   * @param permissions 权限列表
   * @throws BadRequestError 如果包含无效权限
   */
  validatePermissions(permissions: string[]): void {
    const invalidPermissions = permissions.filter((p) => !isValidPermission(p));
    if (invalidPermissions.length > 0) throw new BadRequestError(`无效的权限: ${invalidPermissions.join(", ")}`);
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

    return this.calculateUserPermissionsWithRoles(user, user.group, options);
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
  async canModifyUserPermissions(operatorUserId: string, targetUserId: string): Promise<void> {
    // 检查是否修改自己的权限
    if (operatorUserId === targetUserId) throw new ForbiddenError("不允许修改自己的权限");

    // 获取操作者和目标用户的信息
    const [operator, target] = await Promise.all([
      this.userRepository.findByIdWithGroup(operatorUserId),
      this.userRepository.findByIdWithGroup(targetUserId),
    ]);

    if (!operator) throw new BadRequestError("操作者用户不存在");
    if (!target) throw new BadRequestError("目标用户不存在");

    // 检查组等级：level越高权限越低，不能修改level小于或等于自己的用户（权限大于或等于自己）
    if ((target.group?.level ?? Infinity) <= (operator.group?.level ?? -1)) throw new ForbiddenError("无权修改等级大于或等于自己的用户的权限");
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

    // 安全检查：检查是否可以修改目标用户的权限
    await this.canModifyUserPermissions(operatorUserId, userId);

    const [user, operator] = await Promise.all([
      this.userRepository.findById(userId),
      this.userRepository.findById(operatorUserId),
    ]);

    if (!user) throw new BadRequestError("用户不存在");
    if (!operator) throw new BadRequestError("操作者用户不存在");

    const currentAdds = this.parsePermissionJson(user.permissionAdds);
    const updatedAdds = Array.from(new Set([...currentAdds, ...permissions]));

    await this.userRepository.updateById(userId, {
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
    await this.canModifyUserPermissions(operatorUserId, userId);

    const [user, operator] = await Promise.all([
      this.userRepository.findById(userId),
      this.userRepository.findById(operatorUserId),
    ]);

    if (!user) throw new BadRequestError("用户不存在");
    if (!operator) throw new BadRequestError("操作者用户不存在");

    const currentRemoves = this.parsePermissionJson(user.permissionRemoves);
    const updatedRemoves = Array.from(new Set([...currentRemoves, ...permissions]));

    await this.userRepository.updateById(userId, {
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
    await this.canModifyUserPermissions(operatorUserId, userId);

    const [user, operator] = await Promise.all([
      this.userRepository.findById(userId),
      this.userRepository.findById(operatorUserId),
    ]);

    if (!user) throw new BadRequestError("用户不存在");
    if (!operator) throw new BadRequestError("操作者用户不存在");

    const beforeAdds = this.parsePermissionJson(user.permissionAdds);
    const beforeRemoves = this.parsePermissionJson(user.permissionRemoves);

    const updateData: any = {};

    if (config.permissionAdds) {
      this.validatePermissions(config.permissionAdds);
      updateData.permissionAdds = Array.from(new Set(config.permissionAdds));
    }

    if (config.permissionRemoves) {
      this.validatePermissions(config.permissionRemoves);
      updateData.permissionRemoves = Array.from(new Set(config.permissionRemoves));
    }

    await this.userRepository.updateById(userId, updateData);

    // 记录业务日志
    const changes: any = { before: {}, after: {} };
    if (config.permissionAdds) {
      changes.before.permissionAdds = beforeAdds;
      changes.after.permissionAdds = updateData.permissionAdds;
    }
    if (config.permissionRemoves) {
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
    await this.canModifyUserPermissions(operatorUserId, userId);

    const [user, operator] = await Promise.all([
      this.userRepository.findById(userId),
      this.userRepository.findById(operatorUserId),
    ]);

    if (!user) throw new BadRequestError("用户不存在");
    if (!operator) throw new BadRequestError("操作者用户不存在");

    const beforeAdds = this.parsePermissionJson(user.permissionAdds);
    const beforeRemoves = this.parsePermissionJson(user.permissionRemoves);

    await this.userRepository.updateById(userId, {
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

  /**
   * 获取用户组的权限列表
   * @param groupId 用户组ID
   * @returns 权限列表
   */
  async getGroupPermissions(groupId: string): Promise<PermissionList> {
    const group = await this.groupRepository.findById(groupId);

    if (!group) return [];

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
  ): Promise<void> {
    this.validatePermissions(permissions);

    const group = await this.groupRepository.findById(groupId);
    if (!group) throw new BadRequestError("用户组不存在");

    const beforePermissions = this.parsePermissionJson(group.permissions);
    const afterPermissions = Array.from(new Set(permissions));

    await this.groupRepository.updateById(groupId, {
      permissions: afterPermissions,
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
