import type { Request, Response, NextFunction } from "express";
import { authMiddleware } from "./auth_guard";
import { isLocalRequest } from "./local_auth";

/**
 * Swagger UI 认证中间件
 *
 * 访问控制策略：
 * 1. 静态资源（JS、CSS等）：直接放行
 * 2. 本地 IP 访问（127.0.0.1、::1 等）：放行
 * 3. 本地页面跳转（referer 来自 localhost）：放行
 * 4. 外部来源访问（外部 IP 或外部域名）：需要 JWT 认证
 *
 * 原因：
 * - 通过 IP 检查判断是否为本地访问，比 referer 更可靠
 * - 静态资源请求不会自动带上 token，必须放行
 * - 防止 Swagger UI 被外部网站嵌入或引用，提高安全性
 */
export async function swaggerAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  // Swagger UI 静态资源路径列表
  const staticResourcePaths = [
    "/swagger-ui.css",
    "/swagger-ui-bundle.js",
    "/swagger-ui-standalone-preset.js",
    "/swagger-ui-init.js",
    "/favicon-16x16.png",
    "/favicon-32x32.png",
  ];

  // 检查是否是静态资源请求
  const isStaticResource = staticResourcePaths.some((path) => req.path.endsWith(path));

  if (isStaticResource)
    // 静态资源放行，不需要认证
    return next();

  // 检查是否为本地请求
  if (isLocalRequest(req))
    // 本地请求放行，不需要认证
    return next();

  // 其他情况（外部请求），需要 JWT 认证
  return authMiddleware(req as any, res, next);
}
