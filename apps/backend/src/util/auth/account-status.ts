import { ForbiddenError, UnauthorizedError } from "@/util/errors";
import { CustomCode } from "@/constant/custom-code";
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("AccountStatus", LogCategory.SECURITY);

/**
 * 账户状态枚举
 */
export enum AccountStatus {
  /** 已删除 */
  DELETED = -1,
  /** 已禁用 */
  DISABLED = 0,
  /** 正常激活 */
  ACTIVE = 1,
}

/**
 * 检查账户状态是否有效
 * @param status 用户状态
 * @param userId 用户ID（用于日志）
 * @param context 上下文信息（用于日志）
 * @throws {ForbiddenError} 账户被禁用
 * @throws {UnauthorizedError} 账户已删除
 */
export function validateAccountStatus(status: number, userId?: string, context?: string): void {
  const logContext = context ? ` [${context}]` : "";
  const userInfo = userId ? ` userId=${userId}` : "";

  if (status === AccountStatus.DISABLED) {
    logger.warn(`Account disabled${userInfo}${logContext}`);
    throw new ForbiddenError("账号已被禁用，请联系管理员", CustomCode.ACCOUNT_DISABLED);
  }

  if (status === AccountStatus.DELETED) {
    logger.warn(`Account deleted${userInfo}${logContext}`);
    throw new UnauthorizedError("账号已被删除");
  }

  // 只有 AccountStatus.ACTIVE 才是正常状态
  if (status !== AccountStatus.ACTIVE) {
    logger.warn(`Invalid account status: ${status}${userInfo}${logContext}`);
    throw new UnauthorizedError("账号状态异常");
  }
}

/**
 * 检查账户是否处于激活状态
 * @param status 用户状态
 * @returns 是否激活
 */
export function isAccountActive(status: number): boolean {
  return status === AccountStatus.ACTIVE;
}
