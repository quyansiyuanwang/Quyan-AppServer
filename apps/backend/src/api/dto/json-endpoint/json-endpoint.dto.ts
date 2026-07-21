/**
 * JSON Endpoint DTOs
 */

/**
 * 创建 JSON 端点请求
 */
export interface CreateJsonEndpointDto {
  /**
   * 端点名称
   */
  name: string;
  /**
   * URL Slug (仅允许小写字母、数字、连字符、下划线)
   */
  slug: string;
  /**
   * 描述
   */
  description?: string;
  /** JSON 内容 */
  jsonContent: any;
  /** 是否公开访问 */
  isPublic: boolean;
  /**
   * 访问密码 (仅当 isPublic=false 时需要)
   */
  password?: string;
  /** 非公开端点的访问模式 */
  accessMode?: "static-password" | "public-key";
  /** Ed25519 SPKI PEM 公钥，仅当 accessMode=public-key 时需要 */
  publicKey?: string;
  ownerUserId?: string;
  isRootSlug?: boolean;
}

/**
 * 更新 JSON 端点请求
 */
export interface UpdateJsonEndpointDto {
  /**
   * 端点名称
   */
  name?: string;
  /**
   * 描述
   */
  description?: string;
  /** JSON 内容 */
  jsonContent?: any;
  /** 是否公开访问 */
  isPublic?: boolean;
  /**
   * 更新访问密码 (可选)
   */
  password?: string;
  /** 非公开端点的访问模式 */
  accessMode?: "static-password" | "public-key";
  /** Ed25519 SPKI PEM 公钥，仅当 accessMode=public-key 时需要 */
  publicKey?: string;
  isRootSlug?: boolean;
}

/**
 * JSON 端点响应 (管理端)
 */
export interface JsonEndpointDto {
  id: string;
  userId: string;
  ownerUsername: string;
  name: string;
  slug: string;
  isRootSlug: boolean;
  publicUrl: string;
  description?: string;
  jsonContent: any;
  isPublic: boolean;
  hasPassword: boolean; // 是否设置了密码
  hasPublicKey: boolean;
  accessMode?: "static-password" | "public-key";
  publicKey?: string;
  publicKeyFingerprint?: string;
  signatureAlgorithm?: string;
  accessCount: number;
  lastAccessAt?: string;
  createTime: string;
  updateTime: string;
}

export interface JsonEndpointOwnerOptionDto {
  id: string;
  username: string;
}

/**
 * 公开访问的 JSON 数据
 */
export interface PublicJsonData {
  /** JSON 数据内容 */
  data: any;
  /** Slug */
  slug: string;
  ownerUsername: string;
  publicUrl: string;
  /** 最后更新时间 */
  lastUpdated: string;
}
