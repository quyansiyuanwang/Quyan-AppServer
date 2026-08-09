import type { Request, Response, NextFunction } from "express";
import { getLogger, LogCategory } from "@/util/logger";
import { PayloadTooLargeError } from "@/util/errors";

const logger = getLogger("RequestSizeGuard", LogCategory.SYSTEM);

/**
 * 返回适合当前请求 Content-Type 的字节上限。
 */
function resolveLimit(
  req: Request,
  opts: { maxJsonBytes: number; maxMultipartBytes: number; maxArchiveBytes?: number; maxOtherBytes: number },
): number {
  const ct = (req.headers["content-type"] || "").toLowerCase();
  if (ct.startsWith("application/json")) return opts.maxJsonBytes;
  if (ct.startsWith("multipart/form-data")) return opts.maxMultipartBytes;
  if (
    req.path.startsWith("/v1/data-maintenance/imports/") &&
    (ct.startsWith("application/gzip") ||
      ct.startsWith("application/x-gzip") ||
      ct.startsWith("application/octet-stream"))
  )
    return opts.maxArchiveBytes ?? opts.maxOtherBytes;
  return opts.maxOtherBytes;
}

/**
 * 请求体大小守卫。
 *
 * 两层防护：
 *  1. 快速路径：读取 Content-Length 并立即拒绝超限请求（对诚实客户端有效）。
 *  2. 实际字节计数：监听 req 的 data 事件，累计实际到达的字节数，
 *     一旦超限立即关闭连接并返回 413，防止伪造 Content-Length 的攻击。
 *
 * ⚠️ 注意：此中间件必须在任何会读取/恢复请求体的中间件之前注册。
 *   如果请求已进入 flowing 模式，则此前已经发出的 chunk 无法被本守卫统计。
 *   data 监听器必须在 body-parser 之前注册，但同样是 flowing 模式，
 *   body-parser 仍可正常收到所有 chunk；当我们终止连接时，
 *   body-parser 会因 socket 关闭而得到错误，该错误会被 exceptionMiddleware 忽略
 *   （因为 res 已经发出过 413 响应，headersSent === true）。
 */
export function createRequestSizeGuard(options: {
  maxJsonBytes: number;
  maxMultipartBytes: number;
  maxArchiveBytes?: number;
  maxOtherBytes: number;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const limit = resolveLimit(req, options);
    const requestStream = req as Request & { readableFlowing?: boolean | null };

    if (requestStream.readableFlowing === true)
      logger.warn("RequestSizeGuard attached after request entered flowing mode; early chunks may be missed", {
        path: req.path,
        method: req.method,
        ip: req.ip,
      });

    // ── 第一层：Content-Length 预检（快速路径）────────────────────────────
    const clHeader = req.headers["content-length"];
    if (clHeader) {
      const claimed = parseInt(clHeader, 10);
      if (Number.isFinite(claimed) && claimed > limit) {
        logger.warn("Request rejected by Content-Length pre-check", {
          path: req.path,
          method: req.method,
          claimed,
          limit,
          ip: req.ip,
        });
        next(new PayloadTooLargeError(buildMessage(limit)));
        return;
      }
    }

    // ── 第二层：实际字节计数（防止伪造 Content-Length）────────────────────
    let bytesReceived = 0;
    let terminated = false;

    const onData = (chunk: Buffer | string) => {
      bytesReceived += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);

      if (!terminated && bytesReceived > limit) {
        terminated = true;

        req.removeListener("data", onData);
        req.removeListener("end", onEnd);

        logger.warn("Request body exceeded limit (forged/missing Content-Length)", {
          path: req.path,
          method: req.method,
          bytesReceived,
          limit,
          claimedContentLength: clHeader ?? "(none)",
          ip: req.ip,
        });

        if (!res.headersSent)
          res.status(413).json({
            code: 1002,
            message: buildMessage(limit),
          });

        // 先附加 error 监听器再 destroy，防止 body-parser 收到流 error 时触发 unhandledRejection
        // body-parser 的内部 error handler 也会监听，但顺序不确定，显式消费以防万一
        req.once("error", () => {});
        req.destroy(new Error("Payload Too Large"));
      }
    };

    const onEnd = () => {
      req.removeListener("data", onData);
    };

    req.on("data", onData);
    req.once("end", onEnd);

    next();
  };
}

function buildMessage(limitBytes: number): string {
  const mb = (limitBytes / 1024 / 1024).toFixed(1);
  return `Request body too large. Maximum allowed size is ${mb} MB.`;
}
