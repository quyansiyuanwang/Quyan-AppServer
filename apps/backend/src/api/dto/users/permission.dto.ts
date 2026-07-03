import { Permission } from "@/constant/permission";

/**
 * 权限列表DTO - 用于API传输
 */
export interface PermissionListDTO {
  /** 权限列表 */
  permissions: Permission[];
}

/**
 * 用户权限配置DTO - 设置用户权限
 */
export interface SetUserPermissionDTO {
  /**
   * 额外添加的权限列表
   */
  permissionAdds?: Permission[];
  /**
   * 需要移除的权限列表
   */
  permissionRemoves?: Permission[];
}

/**
 * 添加权限DTO
 */
export interface AddPermissionsDTO {
  /**
   * 要添加的权限列表
   */
  permissions: Permission[];
}

/**
 * 移除权限DTO
 */
export interface RemovePermissionsDTO {
  /**
   * 要移除的权限列表
   */
  permissions: Permission[];
}

/**
 * 检查权限请求DTO
 */
export interface CheckPermissionsDTO {
  /**
   * 用户ID
   */
  userId: string;
  /**
   * 需要检查的权限列表
   */
  permissions: Permission[];
}

/**
 * 用户完整权限响应DTO
 */
export interface UserFullPermissionsDTO {
  /** 用户ID */
  userId: string;
  /** RAM主账号ID */
  accountOwnerId?: string;
  /** 用户组权限 */
  groupPermissions: Permission[];
  /** 额外添加的权限 */
  additionalPermissions: Permission[];
  /** 角色派生权限 */
  rolePermissions?: Permission[];
  /** 当前扮演角色派生权限 */
  assumedRolePermissions?: Permission[];
  /** 已绑定角色 */
  roles?: Array<{ id: string; name: string; source: "user" | "group" }>;
  /** 当前扮演角色 */
  assumedRole?: { id: string; name: string; sessionId?: string };
  /** 移除的权限 */
  removedPermissions: Permission[];
  /** 最终有效权限列表 */
  effectivePermissions: Permission[];
}

/**
 * 权限检查结果响应DTO
 */
export interface PermissionCheckResultDTO {
  /** 是否拥有权限 */
  hasPermission: boolean;
  /** 缺失的权限列表 */
  missingPermissions?: Permission[];
  /** 检查的权限列表 */
  checkedPermissions: Permission[];
}

/**
 * 获取所有权限响应DTO
 */
export interface AllPermissionsDTO {
  /** 所有可用的权限列表 */
  permissions: {
    /** 权限值 */
    value: string;
    /** 权限名称 */
    name: string;
    /** 权限分类 */
    category: string;
  }[];
}
