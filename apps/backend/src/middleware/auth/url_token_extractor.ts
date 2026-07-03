import type { Request, Response, NextFunction } from "express";

/**
 * URL Token 提取中间件
 * 将 URL 查询参数中的 token 提取并放入 Authorization header
 *
 * 使用场景：
 * - 允许通过 URL 参数传递 token，例如：?token=xxx
 * - 自动将 URL token 转换为标准的 Authorization header 格式
 * - 支持 Gemini API 的 x-goog-api-key 请求头格式
 * - 不会覆盖已存在的 Authorization header（header 优先级更高）
 *
 * @example
 * // 在 app.ts 中使用：
 * import { urlTokenExtractor } from "./middleware/url_token_extractor";
 * app.use(urlTokenExtractor);
 */
export function urlTokenExtractor(req: Request, res: Response, next: NextFunction) {
  // 如果已经有 Authorization header，则不处理（header 优先级更高）
  if (req.headers.authorization) return next();

  // 检查 Gemini API 的 x-goog-api-key 请求头
  const geminiApiKey = req.headers["x-goog-api-key"];
  if (geminiApiKey && typeof geminiApiKey === "string") {
    req.headers.authorization = `Bearer ${geminiApiKey.trim()}`;
    return next();
  }

  // 检查 URL 查询参数中是否有 token
  const urlToken = req.query.token;

  if (urlToken && typeof urlToken === "string")
    // 将 URL token 设置到 Authorization header
    req.headers.authorization = `Bearer ${urlToken.trim()}`;

  next();
}
