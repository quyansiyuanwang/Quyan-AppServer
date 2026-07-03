import type { Request, Response, NextFunction } from "express";
import { authMiddleware } from "./auth_guard";

/**
 * 检查 IP 地址是否为本地地址
 * @param ip 客户端 IP 地址
 * @returns 是否为本地 IP
 */
export function isLocalIP(ip: string | undefined): boolean {
  if (!ip) return false;

  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip.startsWith("127.") || ip === "localhost";
}

/**
 * 综合检查请求是否来自本地
 * 检查项：
 * 1. 客户端 IP 是否为本地 IP
 *
 * @param req Express Request 对象
 * @returns 是否为本地请求
 */
export function isLocalRequest(req: Request): boolean {
  // 检查客户端 IP
  const clientIp = req.ip || req.socket.remoteAddress;
  if (isLocalIP(clientIp)) return true;

  return false;
}

/**
 * 本地认证中间件
 *
 * 访问控制策略：
 * - 如果是本地请求（本地 IP 来自 localhost），放行
 * - 如果是外部请求，需要 JWT 认证
 *
 * 使用示例：
 * ```typescript
 * app.use('/docs', localAuthMiddleware, swaggerUI.serve, swaggerUI.setup(...));
 * ```
 */
export async function localAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  // 检查是否为本地请求
  if (isLocalRequest(req))
    // 本地请求放行
    return next();

  // 外部请求需要 JWT 认证
  return authMiddleware(req as any, res, next);
}
