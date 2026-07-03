import type { Request, Response, NextFunction } from "express";
import { ApiRoutePath, ALL_API_ROUTE_PATHS } from "@/build/route-paths";

type V2Route = Extract<ApiRoutePath, `/v2${string}`>;

interface DeprecatedOptions {
  /** RFC1123 格式的移除日期，如 "Sat, 31 Dec 2027 23:59:59 GMT" */
  sunsetDate?: string;
  /**
   * 手动指定新版路径。
   * 使用 ApiRoutePath 枚举，编译时类型安全，防止拼写错误。
   *
   * @example
   *   deprecated({ successor: ApiRoutePath.V2Usage })
   */
  successor?: V2Route;
  /**
   * 自动将当前请求路径中的版本号 v{N} 递增为 v{N+1} 作为 successor。
   * 例如 /v1/usage → /v2/usage，/relay/proxy/v2/chat → /relay/proxy/v3/chat。
   * 与 `successor` 互斥，同时指定时 `successor` 优先。
   */
  autoSuccessor?: boolean;
}

/**
 * 标记端点为已弃用，响应含 Deprecation header。
 *
 * @example
 *   // 手动指定新版路径（推荐，类型安全）
 *   @Middlewares(deprecated({ successor: ApiRoutePath.V2Usage }))
 *
 * @example
 *   // 自动推导 /v1/xxx → /v2/xxx
 *   @Middlewares(deprecated({ autoSuccessor: true }))
 */
export function deprecated(opts?: DeprecatedOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("Deprecation", "true");
    if (opts?.sunsetDate) res.setHeader("Sunset", opts.sunsetDate);

    let successorPath: string | undefined;
    if (opts?.successor) successorPath = opts.successor;
    else if (opts?.autoSuccessor) {
      const candidate = req.path.replace(/\/v(\d+)\//, (_match, version) => `/v${Number(version) + 1}/`);
      if (candidate !== req.path && (ALL_API_ROUTE_PATHS as readonly string[]).includes(candidate))
        successorPath = candidate;
    }

    if (successorPath) res.setHeader("Link", `<${successorPath}>; rel="successor-version"`);

    console.warn(`[Deprecated] ${req.method} ${req.path} -> successor: ${successorPath || "none"}`);

    next();
  };
}

/**
 * 标记端点为 beta 测试版，响应含 X-API-Version-Status: beta header。
 *
 * @example
 *   @Middlewares(beta())
 *   async getUsage() { ... }
 */
export function beta() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("X-API-Version-Status", "beta");
    next();
  };
}
