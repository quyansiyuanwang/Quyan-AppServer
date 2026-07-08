/**
 * 日志系统配置
 * 集中管理所有日志相关的配置项
 */

import { ApiRoutePath, ApiRoutePathPrefix } from "@/build/route-paths";

export type ApiLoggingPath = ApiRoutePath | ApiRoutePathPrefix;

export type LoggingConfig = {
  sensitiveFields: readonly string[];
  excludeResponsePaths: readonly ApiLoggingPath[];
  internalLogMetadataKey: string;
  alwaysSkipLoggingPaths: readonly ApiLoggingPath[];
  skipLoggingPaths: readonly ApiLoggingPath[];
  skipLoggingStatusCodes: readonly number[];
  maxResponseSize: number;
  maxRequestParamsSize: number;
  maxDepth: number;
};

/**
 * 敏感字段列表（需要过滤的字段）
 * 这些字段的值会被替换为 "***FILTERED***"
 */
export const SENSITIVE_FIELDS = [
  "password",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "set-cookie",
  "secret",
  "apiKey",
  "api_key",
  "x-api-key",
  "privateKey",
  "private_key",
] as const satisfies readonly string[];

/**
 * 不记录响应体的路径列表（防止递归套娃）
 * 这些路径的请求会被记录，但响应体会被替换为占位符
 */
export const EXCLUDE_RESPONSE_PATHS = [
  ApiRoutePath.V1SystemLogs, // 系统日志查询（含 API 日志查询）
  ApiRoutePath.V1SystemServerLogFiles, // 服务器文件日志查询
  ApiRoutePath.V1BusinessLogs, // 业务日志查询
] as const satisfies readonly ApiLoggingPath[];

/**
 * 内部日志元数据字段名
 * 用于附加派生信息（如响应体大小），不对前端直接暴露
 */
export const INTERNAL_LOG_METADATA_KEY = "__appServerLogMeta";

/**
 * 始终完全跳过的路径列表
 * 这些路径会在 `logRequest()` 的最前面直接 `return`
 * 与响应状态码无关：无论 2xx / 4xx / 5xx 都不会写入 API 日志
 * 适用于“确定永远不需要记录”的接口
 */
export const ALWAYS_SKIP_LOGGING_PATHS = [
  ApiRoutePath.V1SystemLogs, // 系统日志查询
  ApiRoutePath.V1UsersMeHeartbeat, // 心跳接口（高频在线状态上报，始终不记录）
  ApiRoutePath.V1TrackBatch, // 批量埋点接口（高频请求，始终不记录）
  ApiRoutePath.V1HeatmapCollect
] as const satisfies readonly ApiLoggingPath[];

/**
 * 条件跳过的路径列表
 * 这些路径不是“永远不记录”，而是按 `logRequest()` 当前逻辑做条件跳过：
 * - 默认仅在成功响应（通常 < 400）时跳过
 * - 如果返回错误响应，仍然允许写入 API 日志以保留可观测性
 * 适用于“成功时太高频没必要记，但失败时仍值得审计/排障”的接口
 */
export const SKIP_LOGGING_PATHS = [
  ApiRoutePath.V1AuthRefresh, // Token 刷新接口（高频请求）
  ApiRoutePath.V1AuthReplaySigningSession, // 防重放签名会话（高频预热请求）
  ApiRoutePathPrefix.RelayProxy, // AI 中转接口前缀，覆盖多个子路由
  ApiRoutePath.V1SystemServerLogFiles, // 服务器文件日志查询
  ApiRoutePath.V1RemoteTerminalAgentHeartbeat, // 远程终端代理心跳
] as const satisfies readonly ApiLoggingPath[];

/**
 * 不记录的 HTTP 状态码列表
 * 这些状态码的请求不会被记录到数据库
 */
export const SKIP_LOGGING_STATUS_CODES: number[] = [
  // 401 已移除 - 现在会记录所有未授权访问尝试（安全审计需要）
];

/**
 * 响应体最大尺寸（字符数）
 * 超过此大小的响应体会被截断
 */
export const MAX_RESPONSE_SIZE = 4096;

/**
 * 请求参数最大尺寸（字符数）
 * 超过此大小的请求参数（body/query）会被截断
 */
export const MAX_REQUEST_PARAMS_SIZE = 2048;

/**
 * 对象嵌套最大深度
 * 防止递归数据结构导致的内存问题
 */
export const MAX_DEPTH = 3;

/**
 * 日志配置对象（可选，用于统一导出）
 */
export const LOGGING_CONFIG: LoggingConfig = {
  sensitiveFields: SENSITIVE_FIELDS,
  excludeResponsePaths: EXCLUDE_RESPONSE_PATHS,
  internalLogMetadataKey: INTERNAL_LOG_METADATA_KEY,
  alwaysSkipLoggingPaths: ALWAYS_SKIP_LOGGING_PATHS,
  skipLoggingPaths: SKIP_LOGGING_PATHS,
  skipLoggingStatusCodes: SKIP_LOGGING_STATUS_CODES,
  maxResponseSize: MAX_RESPONSE_SIZE,
  maxRequestParamsSize: MAX_REQUEST_PARAMS_SIZE,
  maxDepth: MAX_DEPTH,
};
