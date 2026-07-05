import express from "express";
import cors from "cors";
import { loggingMiddleware } from "./middleware/logging";
import { exceptionMiddleware } from "./middleware/exception";
import { requestIdMiddleware } from "./middleware/request_id";
import { urlTokenExtractor } from "./middleware/auth/url_token_extractor";
import { responseWrapperMiddleware } from "./middleware/response-wrapper";
import { ipBlacklistCheckMiddleware } from "./middleware/ip-blacklist-check";
import { errorTrackerMiddleware } from "./middleware/error-tracker";
import { streamingMiddleware } from "./middleware/streaming.middleware";
import { localeMiddleware } from "./middleware/locale";
import { createRequestSizeGuard } from "./middleware/request-size-guard";
import { startMemoryMonitor } from "./middleware/memory-monitor";
import { RegisterRoutes } from "./build/routes";
import { HttpStatusCode } from "axios";
import { CustomCode } from "./constant/custom-code";
import { EnvSpace } from "./config/env";
import { registerSwaggerUi } from "./util/swagger-ui";
import { SystemService } from "./services/system/system.service";
import { RedisService } from "./services/infrastructure/redis.service";
import { getLogger, LogCategory } from "./util/logger";
import { DEFAULT_BACKEND_LOCALE, translateMessage } from "./locales";
import { createCorsOriginAllowlist, isCorsOriginAllowed } from "./util/cors-origin-matcher";

const logger = getLogger("App", LogCategory.APPLICATION);
const LARGE_REQUEST_LOG_THRESHOLD_BYTES = 1024 * 1024;

function parseContentLength(value: string | string[] | undefined): number | null {
  if (!value) return null;

  const rawValue = Array.isArray(value) ? value[0] : value;
  const contentLength = Number.parseInt(rawValue, 10);
  return Number.isFinite(contentLength) && contentLength >= 0 ? contentLength : null;
}

export function createApp() {
  const app = express();
  const requestSizeLimitConfig = EnvSpace.requestSizeLimitConfig;

  const corsAllowedOrigins = createCorsOriginAllowlist(String(process.env.CORS_ALLOWED_ORIGINS || ""));

  // 允许前端跨域访问
  app.use(
    cors({
      origin: (origin, callback) => {
        // Non-browser callers may not send Origin header.
        if (!origin) return callback(null, true);

        if (corsAllowedOrigins.length === 0) return callback(null, true);
        if (isCorsOriginAllowed(origin, corsAllowedOrigins)) return callback(null, true);

        return callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      exposedHeaders: ["x-request-id", "x-upstream-request-id"],
    }),
  );

  // Record request size before body parsers run. This makes large uploads visible even
  // if the request later times out or fails before the normal finish log is written.
  app.use((req, res, next) => {
    const contentLengthBytes = parseContentLength(req.headers["content-length"]);
    res.locals.requestSize = {
      contentLengthBytes,
      contentType: req.headers["content-type"],
      transferEncoding: req.headers["transfer-encoding"],
    };

    if (contentLengthBytes !== null && contentLengthBytes >= LARGE_REQUEST_LOG_THRESHOLD_BYTES)
      logger.info("Large request received", {
        method: req.method,
        path: req.originalUrl || req.url,
        contentLengthBytes,
        contentType: req.headers["content-type"],
        ip: req.ip || req.socket.remoteAddress,
      });

    next();
  });

  // ── 实际字节计数守卫（两层防护）────────────────────────────────────────
  // 第一层：检查 Content-Length 头（快速拒绝诚实客户端的超大请求）
  // 第二层：监听 data 事件计算实际到达字节，防止伪造 Content-Length 的攻击
  // 必须在所有 body-parser 之前注册
  app.use(
    createRequestSizeGuard({
      maxJsonBytes: requestSizeLimitConfig.jsonBodyLimitMb * 1024 * 1024,
      maxMultipartBytes: EnvSpace.relayResourceGuardConfig.multipartBodyLimitMb * 1024 * 1024,
      maxOtherBytes: requestSizeLimitConfig.otherBodyLimitMb * 1024 * 1024,
    }),
  );

  // Keep multipart relay uploads bounded. Large image payloads can otherwise monopolize
  // memory and bandwidth on small instances before route-level guards run.
  app.use(
    "/relay/proxy",
    express.raw({
      type: ["multipart/form-data"],
      limit: `${EnvSpace.relayResourceGuardConfig.multipartBodyLimitMb}mb`,
    }),
  );
  app.use(express.json({ limit: `${requestSizeLimitConfig.jsonBodyLimitMb}mb` }));
  app.use(express.urlencoded({ extended: true, limit: `${requestSizeLimitConfig.urlencodedBodyLimitMb}mb` }));
  app.set("trust proxy", true);

  app.use((req, _res, next) => {
    const originalCookie = req.res?.cookie?.bind(req.res);
    const originalClearCookie = req.res?.clearCookie?.bind(req.res);

    if (req.res && originalCookie && originalClearCookie) {
      req.res.cookie = originalCookie;
      req.res.clearCookie = originalClearCookie;
    }

    next();
  });

  // 内存监控：使用独立定时器，与请求周期解耦，避免在每次请求上调用 process.memoryUsage()
  // 2v2g 服务器实际可用约 500MB，堆内存超过 1.2GB 时告警
  startMemoryMonitor({ intervalMs: 60000, warningThresholdMb: 1200 });

  app.use(localeMiddleware);

  // Configure server timeouts to prevent hanging connections
  app.use((req, res, next) => {
    // Set response timeout to 10 minutes (600 seconds)
    res.setTimeout(600000, () => {
      logger.warn("Response timeout", { path: req.path, method: req.method });
      if (!res.headersSent)
        res.status(504).json({
          code: 504,
          message: translateMessage("errors.gatewayTimeout", req.locale ?? DEFAULT_BACKEND_LOCALE),
        });
    });
    next();
  });

  // URL token 提取中间件 - 将 URL 参数中的 token 转换为 Authorization header
  app.use(urlTokenExtractor);

  app.use(requestIdMiddleware);
  app.use(loggingMiddleware);

  // 响应包装中间件 - 将所有成功响应包装为 {code, message, data} 格式
  // 必须在路由注册前，以便重写 res.json 方法
  app.use(responseWrapperMiddleware);

  // 错误跟踪中间件 - 跟踪 IP 错误并自动封禁
  // 必须在 IP 黑名单检查之前，以便拦截被封禁IP的403响应
  app.use(errorTrackerMiddleware);

  // IP 黑名单检查中间件 - 阻止被封禁的 IP 访问
  app.use(ipBlacklistCheckMiddleware);

  // 流式响应中间件 - 拦截并处理 stream=true 的请求
  app.use(streamingMiddleware);

  // 注册所有 TSOA 生成的路由（包括 auth, user, docs/openapi.json 等）
  // 必须在 Swagger UI 之前注册，以便 /docs/openapi.json 能正常工作
  RegisterRoutes(app);
  registerSwaggerUi(app);

  // Catch-all for 404
  app.use((req, res) => {
    res.status(HttpStatusCode.NotFound).json({
      code: CustomCode.NOT_FOUND,
      message: translateMessage("errors.notFound", req.locale ?? DEFAULT_BACKEND_LOCALE),
    });
  });

  app.use(exceptionMiddleware);

  return app;
}

export function setupService() {
  // 在这里执行任何必要的服务初始化，例如数据库连接、缓存设置等
  logger.info("Initializing services...");
  SystemService.getInstance(); // init for uptime
  RedisService.getInstance(); // init Redis connection
}
