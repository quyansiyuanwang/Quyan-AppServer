import type { UserDto } from "@/api/dto/users/user.dto";
import type { CaptchaProviderDto } from "@/api/dto/system/config.dto";

/**
 * 登录请求
 */
export interface LoginDto {
  /**
   * 用户名
   */
  username: string;

  /**
   * 密码
   */
  password: string;

  /**
   * 是否已同意服务协议与隐私政策
   */
  agreedToLegalPolicies: true;

  /**
   * 验证码 token（可选，用于人机验证）
   */
  captchaToken?: string;
}

/**
 * 登录二次验证请求
 */
export interface VerifyTwoFactorLoginDto {
  /**
   * challenge token
   */
  challengeToken: string;

  /**
   * TOTP 动态码（与 recoveryCode 二选一）
   */
  code?: string;

  /**
   * 恢复码（与 code 二选一）
   */
  recoveryCode?: string;

  /**
   * 邮箱验证码（与 code/recoveryCode 二选一）
   */
  emailCode?: string;
}

/**
 * 发送登录二次验证邮箱验证码请求
 */
export interface SendTwoFactorEmailCodeDto {
  /**
   * challenge token
   */
  challengeToken: string;

  /**
   * 验证码 token（可选，用于人机验证）
   */
  captchaToken?: string;
}

export interface VerifyCaptchaTrustDto {
  captchaToken: string;
  action: string;
  provider: Exclude<CaptchaProviderDto, "none">;
}

export interface VerifyCaptchaTrustResponse {
  trusted: true;
  expiresInSeconds: number;
}

export interface CaptchaTrustStatusResponse {
  trusted: boolean;
  expiresInSeconds: number;
}

/**
 * 刷新令牌请求
 */
export interface RefreshDto {
  /**
   * 刷新令牌（可选；HTTP 请求优先从 HttpOnly Cookie 读取，其次读取请求体）
   */
  refresh_token?: string;
}

/**
 * 验证令牌请求
 */
export interface VerifyDto {
  /**
   * 访问令牌
   */
  access_token: string;
}

/**
 * 防重放签名会话
 */
export interface ReplaySigningSessionData {
  /** 会话标识 */
  sessionId: string;

  /** 短期签名密钥 */
  signingKey: string;

  /** 签名算法 */
  algorithm: "HMAC-SHA256";

  /** 过期秒数 */
  expiresIn: number;

  /** 过期时间 */
  expiresAt: string;
}

/**
 * 认证响应数据
 */
export interface AuthData {
  /** 访问令牌 */
  access_token: string;

  /** 刷新令牌（仅无 Request 的直接服务调用等非 HTTP 场景返回；HTTP 流写入 HttpOnly Cookie） */
  refresh_token?: string;

  /** 过期时间（可选） */
  expires_in?: number;

  /** 用户信息 */
  user: UserDto;

  /** 二次验证提醒（未开启 2FA 时按周期返回） */
  twoFactorReminder?: TwoFactorReminderData;

  /** 一次性可信令牌（用于高危接口的单次重试，2FA 验证后返回） */
  oneTimeToken?: string;
}

/**
 * 二次验证提醒
 */
export interface TwoFactorReminderData {
  /** 是否建议开启 2FA */
  shouldSetupTwoFactor: true;

  /** 提醒文案 */
  message: string;

  /** 下一次可再次提醒的时间 */
  nextRemindAt: string;

  /** 提醒间隔（天） */
  intervalDays: number;
}

/**
 * 需要二次验证时的登录响应
 */
export interface TwoFactorRequiredData {
  /**
   * 是否需要二次验证
   */
  requiresTwoFactor: true;

  /**
   * 二次验证 challenge token
   */
  challengeToken: string;

  /**
   * 过期秒数
   */
  expiresIn: number;
}

/**
 * 需要重新同意服务协议与隐私政策
 */
export interface PolicyConsentRequiredData {
  /** 是否需要协议同意 */
  requiresPolicyConsent: true;

  /** 协议确认 challenge token */
  challengeToken: string;

  /** 过期秒数 */
  expiresIn: number;
}

/**
 * 刷新令牌响应数据
 */
export interface RefreshData {
  /** 新的访问令牌 */
  access_token: string;

  /** 过期时间（可选） */
  refresh_token?: string;
  expires_in?: number;
}

/**
 * 验证令牌响应数据
 */
export interface VerifyData {
  /** 用户ID */
  userId: string;

  /** 用户名（可选） */
  username?: string;
}

/**
 * 注册请求
 */
export interface RegisterDto {
  /**
   * 用户名
   */
  username: string;

  /**
   * 密码（已 MD5 哈希）
   */
  password: string;

  /**
   * 昵称
   */
  nickname?: string;

  /**
   * 邮箱
   */
  email: string;

  /**
   * 验证码
   */
  verificationCode: string;

  /**
   * 是否已同意服务协议与隐私政策
   */
  agreedToLegalPolicies: true;

  /**
   * 验证码 token（可选，用于人机验证）
   */
  captchaToken?: string;
}

/**
 * 协议确认完成登录请求
 */
export interface AcceptPolicyConsentDto {
  /** 协议确认 challenge token */
  challengeToken: string;

  /** 是否已同意服务协议与隐私政策 */
  agreedToLegalPolicies: true;
}

/**
 * 发送注册验证码请求
 */
export interface SendRegisterVerificationCodeDto {
  /**
   * 邮箱
   */
  email: string;

  /**
   * 验证码 token（可选，用于人机验证）
   */
  captchaToken?: string;
}

/**
 * 发送找回密码验证码请求
 */
export interface SendPasswordResetCodeDto {
  /**
   * 用户名
   */
  username: string;

  /**
   * 邮箱
   */
  email: string;

  /**
   * 验证码 token（可选，用于人机验证）
   */
  captchaToken?: string;
}

/**
 * 重置密码请求
 */
export interface ResetPasswordDto {
  /**
   * 用户名
   */
  username: string;

  /**
   * 邮箱
   */
  email: string;

  /**
   * 验证码
   */
  verificationCode: string;

  /**
   * 新密码（已 MD5 哈希）
   */
  newPassword: string;

  /**
   * 验证码 token（可选，用于人机验证）
   */
  captchaToken?: string;
}

/**
 * 登出请求
 */
export interface LogoutDto {
  /**
   * 访问令牌（可选；缺省时回退读取 Authorization Bearer）
   */
  access_token?: string;

  /**
   * 刷新令牌（可选；HTTP 请求优先从 HttpOnly Cookie 读取，其次读取请求体）
   */
  refresh_token?: string;
}

// API 响应类型
export type LoginResponse = AuthData | TwoFactorRequiredData | PolicyConsentRequiredData;
export type RefreshResponse = RefreshData;
export type VerifyResponse = VerifyData;
export type RegisterResponse = { message: string };
export type SendRegisterVerificationCodeResponse = { message: string };
export type SendPasswordResetCodeResponse = { message: string };
export type ResetPasswordResponse = { message: string };
export type LogoutResponse = { message: string };
export type VerifyTwoFactorLoginResponse = AuthData | PolicyConsentRequiredData;
export type SendTwoFactorEmailCodeResponse = { message: string; maskedEmail?: string };
export type AcceptPolicyConsentResponse = AuthData;
export type ReplaySigningSessionResponse = ReplaySigningSessionData;
