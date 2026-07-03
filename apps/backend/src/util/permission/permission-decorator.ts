import { Permission } from "@/constant/permission";
import { PermissionService } from "@/services/users/permission.service";
import { ForbiddenError } from "../errors";
import { getLogger, LogCategory } from "../logger";
import { isLocalRequest } from "../../middleware/auth/local_auth";
import { SecurityScheme } from "@/middleware/auth/auth_guard";
import { getRequestContext } from "../request-context";
import { EnvSpace } from "@/config/env";
import { validateAccountStatus } from "@/util/auth/account-status";
import { copyFunctionMetadata } from "../decorator-metadata";

const logger = getLogger("PermissionDecorator", LogCategory.SECURITY);

/**
 * 权限检查模式
 */
export enum PermissionCheckMode {
  /** 需要全部权限 */
  ALL = "ALL",
  /** 需要任一权限 */
  ANY = "ANY",
}

/**
 * 权限检查装饰器
 * 用于Controller方法，在方法执行前检查用户权限
 *
 * @example
 * ```typescript
 * @CheckPermission(Permission.USER_CREATE)
 * public async createUser() { ... }
 *
 * @CheckPermission([Permission.USER_READ, Permission.USER_LIST], PermissionCheckMode.ANY)
 * public async getUsers() { ... }
 *
 * @CheckPermission([Permission.USER_UPDATE, Permission.USER_DELETE], PermissionCheckMode.ALL)
 * public async modifyUser() { ... }
 * ```
 */
export function CheckPermission(
  permissions: Permission | Permission[],
  mode: PermissionCheckMode = PermissionCheckMode.ALL,
  secrityName: SecurityScheme,
): MethodDecorator {
  return function (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    const wrappedMethod = async function (this: unknown, ...args: any[]) {
      // 从请求上下文获取request对象，如果没有则从参数中查找（向后兼容）
      let request = getRequestContext();
      if (!request) request = args.find((arg) => arg && arg.user !== undefined);

      if (secrityName === "local-or-jwt" && request && isLocalRequest(request) && !EnvSpace.isTest) {
        // 如果是本地请求且不在测试环境，直接放行，不检查权限
        logger.info(`本地请求访问方法 ${String(propertyKey)}，跳过权限检查`);
        return await originalMethod.apply(this, args);
      }

      if (secrityName === "jwt" || secrityName === "local-or-jwt") {
        if (!request || !request.user || !request.user.userId) throw new ForbiddenError("未授权访问，请先登录");

        const userId = request.user.userId;

        // Defense-in-depth: 从 token 中检查用户状态
        // 如果 token 中没有 status 字段（旧版本 token），则跳过此检查，依赖 auth_guard 的数据库查询
        if (request.user.status !== undefined)
          validateAccountStatus(request.user.status, userId, `permission check: ${String(propertyKey)}`);

        const permissionList = Array.isArray(permissions) ? permissions : [permissions];
        const permissionService = PermissionService.getInstance();
        const permissionOptions = { assumedRoleSessionId: request.user.roleSessionId };

        try {
          if (mode === PermissionCheckMode.ALL) {
            // 需要全部权限
            const result = await permissionService.checkUserPermissions(userId, permissionList, permissionOptions);
            if (!result.hasPermission) {
              logger.warn(
                `用户 ${userId} 调用方法 ${String(propertyKey)} 失败: 缺少权限 ${result.missingPermissions?.join(", ")}`,
              );
              throw new ForbiddenError(`缺少必要权限: ${result.missingPermissions?.join(", ")}`);
            }
          } else if (mode === PermissionCheckMode.ANY) {
            // 需要任一权限
            const result = await permissionService.checkUserPermissions(userId, permissionList, permissionOptions);
            const hasAny = result.checkedPermissions.some(
              (permission) => !result.missingPermissions?.includes(permission),
            );
            if (!hasAny) {
              logger.warn(
                `用户 ${userId} 调用方法 ${String(propertyKey)} 失败: 不具备任何所需权限 ${permissionList.join(", ")}`,
              );
              throw new ForbiddenError(`需要以下权限之一: ${permissionList.join(", ")}`);
            }
          } else {
            logger.error(`未知的权限检查模式: ${mode}`);
            throw new Error(`未知的权限检查模式: ${mode}`);
          }

          logger.info(`用户 ${userId} 通过权限检查，执行方法 ${String(propertyKey)}`);

          // 权限检查通过，执行原方法
          return await originalMethod.apply(this, args);
        } catch (error) {
          // 如果是权限错误，直接抛出
          if (error instanceof ForbiddenError) throw error;

          // 其他错误也抛出
          logger.error(`方法 ${String(propertyKey)} 执行时发生错误: ${error}`);
          throw error;
        }
      } else {
        // 如果没有请求对象，直接执行原方法（可能是非HTTP调用）
        logger.warn(`方法 ${String(propertyKey)} 没有请求对象，无法进行权限检查，直接执行`);
        return await originalMethod.apply(this, args);
      }
    };

    copyFunctionMetadata(originalMethod, wrappedMethod);
    descriptor.value = wrappedMethod;

    return descriptor;
  };
}

/**
 * 需要全部权限的装饰器
 *
 * @example
 * ```typescript
 * @RequireAllPermissions(Permission.USER_UPDATE, Permission.USER_DELETE)
 * public async modifyUser() { ... }
 * ```
 */
export function RequireAllPermissions(permissions: Permission[], secrityName: SecurityScheme = "jwt"): MethodDecorator {
  return CheckPermission(permissions, PermissionCheckMode.ALL, secrityName);
}

/**
 * 需要任一权限的装饰器
 *
 * @example
 * ```typescript
 * @RequireAnyPermission(Permission.USER_READ, Permission.USER_LIST)
 * public async getUsers() { ... }
 * ```
 */
export function RequireAnyPermission(permissions: Permission[], secrityName: SecurityScheme = "jwt"): MethodDecorator {
  return CheckPermission(permissions, PermissionCheckMode.ANY, secrityName);
}

/**
 * 需要单个权限的装饰器（最常用）
 *
 * @example
 * ```typescript
 * @RequirePermission(Permission.USER_CREATE)
 * public async createUser() { ... }
 * ```
 */
export function RequirePermission(permission: Permission, secrityName: SecurityScheme = "jwt"): MethodDecorator {
  return CheckPermission(permission, PermissionCheckMode.ALL, secrityName);
}
