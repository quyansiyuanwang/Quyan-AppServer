export interface IPWhitelistDto {
  id: string;
  ipAddress: string;
  reason?: string;
  addedBy?: string;
  expiresAt?: string;
  createTime: string;
  updateTime: string;
}

export interface CreateIPWhitelistDto {
  /**
   * IP 地址（IPv4 或 IPv6）
   */
  ipAddress: string;
  reason?: string;
  /** 过期时间（ISO 8601），不填则永久有效 */
  expiresAt?: string;
}

export interface GetAllIPWhitelistsResponse {
  whitelists: IPWhitelistDto[];
  total: number;
}

export interface CreateIPWhitelistResponse {
  whitelist: IPWhitelistDto;
}

export interface DeleteIPWhitelistResponse {
  success: boolean;
}

export interface CheckIPWhitelistResponse {
  isWhitelisted: boolean;
}
