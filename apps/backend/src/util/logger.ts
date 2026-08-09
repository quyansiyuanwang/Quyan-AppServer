import fs from "fs";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
import { env } from "@/config/env";

/**
 * 日志类别枚举
 */
export enum LogCategory {
  APPLICATION = "APPLICATION",
  REQUEST = "REQUEST",
  STORAGE = "STORAGE",
  BUSINESS = "BUSINESS",
  AUTH = "AUTH",
  WEBSOCKET = "WEBSOCKET",
  MIDDLEWARE = "MIDDLEWARE",
  UTIL = "UTIL",
  SECURITY = "SECURITY",
  SYSTEM = "SYSTEM",
  TOOLS = "TOOLS",
  REDIS = "REDIS",
  CONFIG = "CONFIG",
}

/**
 * 日志级别
 */
export enum LogLevel {
  ERROR = "error",
  WARN = "warn",
  INFO = "info",
  HTTP = "http",
  VERBOSE = "verbose",
  DEBUG = "debug",
  SILLY = "silly",
}

const isDev = env.runtime.isDevelopment;
const logConfig = env.runtime.logging ?? {
  disableConsoleLog: false,
  enableFileLogging: false,
};
const logsDir = path.join(env.runtime.cwd || process.cwd(), "logs");

function canWriteLogsDir(): boolean {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.accessSync(logsDir, fs.constants.W_OK);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[logger] File logging disabled: cannot write to ${logsDir} (${reason})`);
    return false;
  }
}

/**
 * 自定义日志格式
 */
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, category, module, stack, ...meta }) => {
    const categoryStr = category ? `[${category}]` : "";
    const moduleStr = module ? ` ${module}:` : "";
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    const stackStr = stack ? `\n${stack}` : "";
    return `${timestamp} [${level.toUpperCase()}]${categoryStr}${moduleStr} ${message}${metaStr}${stackStr}`;
  }),
);

/**
 * 控制台格式（带颜色）
 */
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, category, module, stack, ...meta }) => {
    const categoryStr = category ? `[${category}]` : "";
    const moduleStr = module ? ` ${module}:` : "";
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    const stackStr = stack ? `\n${stack}` : "";
    return `${timestamp} ${level}${categoryStr}${moduleStr} ${message}${metaStr}${stackStr}`;
  }),
);

/**
 * JSON 格式（用于生产环境）
 */
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

/**
 * 配置日志传输器
 */
const transports: winston.transport[] = [];

// 控制台输出配置
// 环境变量 DISABLE_CONSOLE_LOG=true 可完全禁用控制台输出
if (!logConfig.disableConsoleLog)
  transports.push(
    new winston.transports.Console({
      format: isDev ? consoleFormat : jsonFormat,
      // 生产环境只输出 ERROR 级别，开发环境输出 DEBUG 及以上
      level: isDev ? LogLevel.DEBUG : LogLevel.ERROR,
      silent: false,
    }),
  );

// 文件日志（仅在生产环境或明确启用时）
if ((!isDev || logConfig.enableFileLogging) && canWriteLogsDir()) {
  // When OSS archival is configured, lifecycle processing owns retention. Letting
  // the transport delete files at 14 days can race the daily archive job and
  // discard a log before its upload has been verified.
  const archiveRetention = env.integrations?.objectStorage?.archive?.enabled ? {} : { maxFiles: "14d" };

  // 错误日志（每天轮换）
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, "error-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      level: LogLevel.ERROR,
      format: customFormat,
      maxSize: "20m",
      zippedArchive: true,
      ...archiveRetention,
    }),
  );

  // 综合日志（每天轮换）
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, "combined-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      format: customFormat,
      maxSize: "20m",
      zippedArchive: true,
      ...archiveRetention,
    }),
  );
}

/**
 * 创建 Winston logger 实例
 */
const winstonLogger = winston.createLogger({
  level: isDev ? LogLevel.DEBUG : LogLevel.INFO,
  transports,
  exitOnError: false,
});

/**
 * Logger 接口
 */
export interface Logger {
  info: (msg: string, context?: any) => void;
  debug: (msg: string, context?: any) => void;
  warn: (msg: string, context?: any) => void;
  error: (msg: string, context?: any) => void;
  http: (msg: string, context?: any) => void;
}

/**
 * 日志内容截断配置
 */
export const LOG_TRUNCATE_CONFIG = {
  /** 单个字段最大长度 */
  maxFieldLength: 1000,
  /** 整个 context 对象最大长度 */
  maxContextLength: 5000,
  /** 是否启用截断 */
  enabled: true,
  /** 截断后缀 */
  truncateSuffix: "...<truncated>",
};

/**
 * 截断长内容
 * @param value 原始值
 * @param maxLength 最大长度
 * @param visited 已访问对象集合（用于检测循环引用）
 * @returns 截断后的值
 */
function truncateValue(value: any, maxLength: number, visited = new WeakSet()): any {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    if (value.length <= maxLength) return value;
    return `${value.substring(0, maxLength)}${LOG_TRUNCATE_CONFIG.truncateSuffix} [原长:${value.length}]`;
  }

  if (typeof value === "object") {
    // 检测循环引用
    if (visited.has(value)) return "[Circular Reference]";

    visited.add(value);

    if (Array.isArray(value)) {
      if (value.length > 10)
        return `[Array(${value.length}) - 仅显示前10项: ${JSON.stringify(value.slice(0, 10))}${LOG_TRUNCATE_CONFIG.truncateSuffix}]`;
      return value.map((item) => truncateValue(item, maxLength, visited));
    }

    const truncated: any = {};
    for (const [key, val] of Object.entries(value)) truncated[key] = truncateValue(val, maxLength, visited);

    return truncated;
  }

  return value;
}

/**
 * 截断 context 对象
 * @param context 原始 context
 * @returns 截断后的 context
 */
function truncateContext(context?: any): any {
  if (!context || !LOG_TRUNCATE_CONFIG.enabled) return context;

  // 先截断每个字段（使用新的 WeakSet 来跟踪循环引用）
  const truncated = truncateValue(context, LOG_TRUNCATE_CONFIG.maxFieldLength, new WeakSet());

  // 检查整体长度
  try {
    const contextStr = JSON.stringify(truncated);
    if (contextStr.length > LOG_TRUNCATE_CONFIG.maxContextLength)
      return {
        _truncated: true,
        _originalSize: contextStr.length,
        _summary: `Context 过大已截断 (${contextStr.length} chars)`,
        _preview: contextStr.substring(0, LOG_TRUNCATE_CONFIG.maxContextLength) + LOG_TRUNCATE_CONFIG.truncateSuffix,
      };

    return truncated;
  } catch (error) {
    // 如果 JSON.stringify 失败（例如仍有循环引用），返回安全的错误信息
    return {
      _error: "Failed to serialize context",
      _reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 获取带有模块和类别信息的 logger
 * @param module 模块名称
 * @param category 日志类别
 * @returns Logger 实例
 */
export function getLogger(module: string, category: LogCategory): Logger {
  return {
    info: (msg: string, context?: any) => {
      winstonLogger.info(msg, { module, category, ...truncateContext(context) });
    },
    debug: (msg: string, context?: any) => {
      winstonLogger.debug(msg, { module, category, ...truncateContext(context) });
    },
    warn: (msg: string, context?: any) => {
      winstonLogger.warn(msg, { module, category, ...truncateContext(context) });
    },
    error: (msg: string, context?: any) => {
      winstonLogger.error(msg, { module, category, ...truncateContext(context) });
    },
    http: (msg: string, context?: any) => {
      winstonLogger.http(msg, { module, category, ...truncateContext(context) });
    },
  };
}

/**
 * 默认导出 Winston logger 实例（用于高级用法）
 */
export default winstonLogger;
