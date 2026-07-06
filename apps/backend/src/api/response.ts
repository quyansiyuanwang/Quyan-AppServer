import { CustomCode } from "@/constant/custom-code";
import { HttpStatusCode } from "axios";

/**
 * HTTP 异常接口
 */
export interface HTTPException {
  status: HttpStatusCode;
  code: CustomCode;
  message: string;
  stack?: string;
}

/**
 * 错误响应格式
 * 用于所有错误情况（4xx, 5xx）
 */
export interface ErrorResponse {
  code: CustomCode;
  message: string;
  fields?: Record<string, any>; // 可选的验证错误字段详情
}

/**
 * 成功响应格式
 * 用于所有成功情况（2xx）
 *
 * @template T 数据类型，可选（无数据时可省略 data 字段）
 * @example
 * ```typescript
 * // 有数据的响应
 * { code: 0, message: "Success", data: { id: "123", name: "Test" } }
 *
 * // 无数据的响应
 * { code: 0, message: "操作成功" }
 * ```
 */
export interface SuccessResponse<T = any> {
  code: CustomCode;
  message: string;
  data?: T;
}
