/**
 * 统一 API 响应格式
 */
export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
  error?: string;
}

/**
 * 分页响应
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 验证失败响应
 */
export interface ValidationErrorResponse {
  code: number;
  message: string;
  fields?: Record<string, string[]>;
}

/**
 * 基础响应接口
 */
export interface BaseResponse {
  code: number;
  message: string;
}
