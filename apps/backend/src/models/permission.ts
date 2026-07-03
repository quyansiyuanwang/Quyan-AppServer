import { Permission } from "@/constant/permission";

/**
 * 权限列表类型
 */
export type PermissionList = Permission[];

/**
 * 用户权限配置接口
 */
export interface UserPermissionConfig {
  /** 额外添加的权限列表 */
  permissionAdds: PermissionList;
  /** 需要移除的权限列表 */
  permissionRemoves: PermissionList;
}

/**
 * 用户组权限配置接口
 */
export interface GroupPermissionConfig {
  /** 用户组拥有的权限列表 */
  permissions: PermissionList;
}

/**
 * 用户完整权限接口
 */
export interface UserFullPermissions {
  /** 用户ID */
  userId: string;
  /** RAM主账号ID */
  accountOwnerId?: string;
  /** 用户组权限 */
  groupPermissions: PermissionList;
  /** 额外添加的权限 */
  additionalPermissions: PermissionList;
  /** 角色派生权限 */
  rolePermissions?: PermissionList;
  /** 策略派生权限 */
  policyPermissions?: PermissionList;
  /** 当前扮演角色派生权限 */
  assumedRolePermissions?: PermissionList;
  /** 已绑定角色 */
  roles?: Array<{ id: string; name: string; source: "user" | "group" }>;
  /** 当前扮演角色 */
  assumedRole?: { id: string; name: string; sessionId?: string };
  /** 移除的权限 */
  removedPermissions: PermissionList;
  /** 最终有效权限列表 */
  effectivePermissions: PermissionList;
}

/**
 * 权限检查结果接口
 */
export interface PermissionCheckResult {
  /** 是否拥有权限 */
  hasPermission: boolean;
  /** 缺失的权限列表 */
  missingPermissions?: Permission[];
  /** 检查的权限列表 */
  checkedPermissions: Permission[];
}
