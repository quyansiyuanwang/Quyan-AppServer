import { ALL_PERMISSIONS, Permission } from "@/constant/permission";

/**
 * 验证权限字符串是否有效
 */
export function isValidPermission(permission: string): permission is Permission {
  return ALL_PERMISSIONS.includes(permission as Permission);
}

/** 验证并过滤权限列表
 * @param permissions 待验证的权限列表
 * @returns 仅包含有效权限的列表
 * @throws 如果存在无效权限则抛出错误
 */
export function validatePermissions(permissions: string[]): Permission[] {
  const invalidPermissions = permissions.filter((p) => !isValidPermission(p));
  if (invalidPermissions.length > 0) throw new Error(`无效的权限: ${invalidPermissions.join(", ")}`);

  return permissions as Permission[];
}
