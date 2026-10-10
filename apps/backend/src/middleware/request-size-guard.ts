import type { Request, Response, NextFunction } from "express";
import { getLogger, LogCategory } from "@/util/logger";
import { PayloadTooLargeError } from "@/util/errors";

const logger = getLogger("RequestSizeGuard", LogCategory.SYSTEM);

export function hasPendingRequestSizeRefusal(res: Pick<Response, "locals">): boolean {
  return Boolean(res.locals?.requestCapacityRejected);
}

/** Send 413 headers immediately, but keep its final chunk until unread input has been discarded. */
function prepareRequestSizeRefusal(req: Request, res: Response): void {
  const originalEnd = res.end;
  res.end = function (...args: any[]) {
    res.end = originalEnd;
    res.locals ??= {};
    res.locals.requestCapacityRejected = true;
    if (req.readableEnded) return originalEnd.apply(res, args as any);
    // json() has calculated Content-Length; chunked framing lets headers arrive before upload ends.
    res.removeHeader("Content-Length");
    const cleanup = () => {
      req.off("end", finish);
      req.off("aborted", cleanup);
      res.off("close", cleanup);
    };
    const finish = () => {
      cleanup();
      if (!res.destroyed && !res.writableEnded) {
        const callback = args.find((value) => typeof value === "function");
        Reflect.apply(originalEnd, res, callback ? [callback] : []);
      }
    };
    req.once("end", finish);
    req.once("aborted", cleanup);
    res.once("close", cleanup);
    const chunk = args[0];
    if (typeof chunk === "string" || chunk instanceof Uint8Array) {
      Reflect.apply(res.write, res, typeof args[1] === "string" ? [chunk, args[1]] : [chunk]);
    }
    return res;
  } as typeof res.end;
}

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
 *     一旦超限停止正文捕获并返回 413，防止伪造 Content-Length 绕过容量限制。
 *
 * ⚠️ 注意：此中间件必须在任何会读取/恢复请求体的中间件之前注册。
 *   如果请求已进入 flowing 模式，则此前已经发出的 chunk 无法被本守卫统计。
 *   data 监听器必须在 body-parser 之前注册，但同样是 flowing 模式，
 *   body-parser 仍可正常收到所有 chunk。超限后通知解析器停止捕获，丢弃剩余正文，
 *   保留已经发出的 413 响应，避免立即销毁 socket 导致客户端只收到连接重置。
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
        prepareRequestSizeRefusal(req, res);
        // Discard unread input without buffering it, so the client receives 413 instead of a reset.
        req.resume();
        next(
          new PayloadTooLargeError(buildMessage(limit), undefined, {
            messageKey: "errors.payloadTooLargeLimit",
            messageParams: { limitMb: Math.round(limit / (1024 * 1024)) },
          }),
        );
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

        if (res.headersSent) {
          req.once("error", () => {});
          req.destroy(new Error("Payload Too Large"));
          return;
        }
        prepareRequestSizeRefusal(req, res);
        res.status(413).json({ code: 1002, message: buildMessage(limit) });
        // Stop body-parser retaining more bytes, then discard the rest without resetting the response.
        req.once("error", () => {});
        req.emit(
          "error",
          new PayloadTooLargeError(buildMessage(limit), undefined, {
            messageKey: "errors.payloadTooLargeLimit",
            messageParams: { limitMb: Math.round(limit / (1024 * 1024)) },
          }),
        );
        req.resume();
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
