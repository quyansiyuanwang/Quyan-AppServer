/**
 * 生成 ReURL 请求
 */
export interface GenerateReURLRequest {
  /**
   * 过期时间（秒），默认 60 秒
   */
  ttl?: number;
  /**
   * 可选，要包装的 JWT token（默认使用当前用户的 token）
   */
  token?: string;
}

/**
 * 生成 ReURL 响应
 */
export interface GenerateReURLResponse {
  /** ReURL ID */
  reurl: string;
  /** 过期时间（秒） */
  expires_in: number;
  /** 使用说明 */
  usage: string;
}
