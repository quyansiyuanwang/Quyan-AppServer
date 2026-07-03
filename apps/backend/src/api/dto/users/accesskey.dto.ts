/**
 * 创建 AccessKey 请求
 */
export interface CreateAccessKeyDto {
  /**
   * AccessKey 名称（可选）
   */
  name?: string;
  /**
   * 过期时间（可选，ISO 8601）
   */
  expiresAt?: string;
  /**
   * 邮箱验证码（未开启 2FA 时必填）
   */
  verificationCode?: string;
}

/**
 * AccessKey 信息
 */
export interface AccessKeyDto {
  /** AccessKey ID */
  id: string;
  /** 用户ID */
  userId: string;
  /** AccessKey 名称 */
  name?: string;
  /** AccessKey 密钥（仅创建时返回，列表中为掩码） */
  key: string;
  /** 过期时间 */
  expiresAt?: string;
  /** 最后使用时间 */
  lastUsedAt?: string;
  /** 请求次数 */
  requestCount: number;
  /** 创建时间 */
  createTime: string;
}

/**
 * 发送 AccessKey 创建验证码响应
 */
export interface SendAccessKeyCreationVerificationCodeResponse {
  /** 响应消息 */
  message: string;
}
