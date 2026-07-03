import type { Request as _Request, Response, NextFunction } from "express";
import { Permission } from "@/constant/permission";
import { permissionService } from "@/services/users/permission.service";
import { ForbiddenError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";

const _logger = getLogger("PermissionGuard", LogCategory.SECURITY);

/**
 * 权限守卫中间件
 * 用于保护需要特定权限的路由
 */
export class PermissionGuard {
  /**
   * 创建权限检查中间件
   * @param requiredPermissions 需要的权限列表（满足任一即可）
   * @param requireAll 是否需要全部权限（默认false，满足任一即可）
   * @returns Express中间件函数
   */
  static require(requiredPermissions: Permission[], requireAll: boolean = false) {
    return async (req: TypedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.userId;

        if (!userId) throw new ForbiddenError("未授权访问");

        const checkResult = await permissionService.checkUserPermissions(userId, requiredPermissions);

        if (requireAll) {
          // 需要全部权限
          if (!checkResult.hasPermission)
            throw new ForbiddenError(`缺少必要权限: ${checkResult.missingPermissions?.join(", ")}`);
        } else {
          // 满足任一权限即可
          const hasAny = await permissionService.hasAnyPermission(userId, requiredPermissions);
          if (!hasAny) throw new ForbiddenError(`需要以下权限之一: ${requiredPermissions.join(", ")}`);
        }

        // 权限检查通过，将权限信息附加到请求对象
        req.permissions = checkResult;
        next();
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * 创建单个权限检查中间件
   * @param permission 需要的权限
   * @returns Express中间件函数
   */
  static requireOne(permission: Permission) {
    return this.require([permission], false);
  }

  /**
   * 创建多个权限检查中间件（全部满足）
   * @param permissions 需要的权限列表
   * @returns Express中间件函数
   */
  static requireAll(...permissions: Permission[]) {
    return this.require(permissions, true);
  }

  /**
   * 创建多个权限检查中间件（满足任一）
   * @param permissions 需要的权限列表
   * @returns Express中间件函数
   */
  static requireAny(...permissions: Permission[]) {
    return this.require(permissions, false);
  }
}

/**
 * 便捷的权限检查装饰器工厂函数
 * 注意：这是一个辅助函数，实际使用时配合中间件
 */
export const RequirePermission = {
  /**
   * 需要单个权限
   */
  one: (permission: Permission) => PermissionGuard.requireOne(permission),

  /**
   * 需要全部权限
   */
  all: (...permissions: Permission[]) => PermissionGuard.requireAll(...permissions),

  /**
   * 需要任一权限
   */
  any: (...permissions: Permission[]) => PermissionGuard.requireAny(...permissions),
};
