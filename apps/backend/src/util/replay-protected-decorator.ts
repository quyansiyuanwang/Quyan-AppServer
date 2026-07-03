import { Extension } from "@tsoa/runtime";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";

/**
 * 防重放保护装饰器（用于@Extension）
 * 添加OpenAPI标记
 */
export function ReplayProtected() {
  return Extension("X-Replay-Protected", true);
}

/**
 * 防重放保护中间件（用于@Middlewares）
 */
export { replayProtectionMiddleware };
