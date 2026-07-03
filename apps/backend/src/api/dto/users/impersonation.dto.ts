export interface StartImpersonationDto {
  /** 目标用户 ID */
  targetUserId: string;
}

export interface ImpersonationTokenData {
  /** 模拟访问 token（短期，无 refresh） */
  access_token: string;
  /** 有效期（秒） */
  expires_in: number;
  /** 目标用户信息 */
  targetUser: {
    id: string;
    username: string;
    name: string | null;
  };
  /** 模拟模式 */
  mode: "view" | "act";
}

export type StartImpersonationResponse = ImpersonationTokenData;
