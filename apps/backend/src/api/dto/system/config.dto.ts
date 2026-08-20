export interface ServerConfigDto {
  key: string;
  value: string;
}

export interface SetConfigDto {
  configs: Record<string, string>;
}

export interface GetConfigResponse {
  configs: Record<string, string>;
}

export interface RegistrationStatusResponse {
  enabled: boolean;
}

export interface HeartbeatConfigDto {
  intervalSeconds: number;
  timeoutSeconds: number;
}

export interface RemoteTerminalUnbindConfigDto {
  maxCount: number;
  windowHours: number;
  rebindCooldownMinutes: number;
}

export interface BillingConfigDto {
  /**
   * 充值比例：1 元可兑换的额度数量
   */
  rechargeRatio: number;
  giftCodeEnabled: boolean;
  directTransferEnabled: boolean;
  giftCodeFeePercent: number;
  directTransferFeePercent: number;
  giftCodeCancelFeeRefundPercent: number;
}

export type CaptchaProviderDto = "none" | "recaptcha" | "turnstile";

export interface CaptchaConfigDto {
  provider: CaptchaProviderDto;
  fallbackProvider: CaptchaProviderDto;
  /**
   * reCAPTCHA v3 最低分数阈值；非评分型验证码场景可忽略
   */
  minScore: number;
  trustWindowMinutes: number;
}

export interface PublicCaptchaConfigDto {
  enabled: boolean;
  provider: CaptchaProviderDto;
  fallbackProvider: CaptchaProviderDto;
}

export interface SocialAuthGithubConfigDto {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
  emailUrl: string;
  scope: string;
  callbackPath: string;
}

export interface SocialAuthWechatConfigDto {
  enabled: boolean;
  appId: string;
  appSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
  scope: string;
  callbackPath: string;
}

export interface SocialAuthConfigDto {
  frontendBaseUrl: string;
  qrLoginEnabled: boolean;
  stateTtlSeconds: number;
  qrLoginTtlSeconds: number;
  qrLoginPollIntervalSeconds: number;
  github: SocialAuthGithubConfigDto;
  wechatOpen: SocialAuthWechatConfigDto;
  wechatWeb: SocialAuthWechatConfigDto;
}

export interface PublicSocialAuthConfigDto {
  githubEnabled: boolean;
  wechatOpenEnabled: boolean;
  wechatWebEnabled: boolean;
  qrLoginEnabled: boolean;
}

export interface SetBillingConfigDto {
  /**
   * 充值比例：1 元可兑换的额度数量
   */
  rechargeRatio: number;
  giftCodeEnabled: boolean;
  directTransferEnabled: boolean;
  giftCodeFeePercent: number;
  directTransferFeePercent: number;
  giftCodeCancelFeeRefundPercent: number;
}

export interface SiteConfigDto {
  /**
   * 后端公开访问地址，用于邮件中的追踪像素等场景
   */
  backendPublicUrl: string;
}

export interface SetSiteConfigDto {
  /**
   * 后端公开访问地址，用于邮件中的追踪像素等场景
   */
  backendPublicUrl: string;
}

export interface SetHeartbeatConfigDto {
  intervalSeconds: number;
  timeoutSeconds: number;
}

export interface SetRemoteTerminalUnbindConfigDto {
  maxCount: number;
  windowHours: number;
  rebindCooldownMinutes: number;
}

export interface SetCaptchaConfigDto {
  provider: CaptchaProviderDto;
  fallbackProvider: CaptchaProviderDto;
  /**
   * reCAPTCHA v3 最低分数阈值；非评分型验证码场景可忽略
   */
  minScore: number;
  trustWindowMinutes: number;
}

export interface SetSocialAuthConfigDto {
  frontendBaseUrl: string;
  qrLoginEnabled: boolean;
  stateTtlSeconds: number;
  qrLoginTtlSeconds: number;
  qrLoginPollIntervalSeconds: number;
  github: SocialAuthGithubConfigDto;
  wechatOpen: SocialAuthWechatConfigDto;
  wechatWeb: SocialAuthWechatConfigDto;
}

export interface SetRegistrationConfigDto {
  enabled: boolean;
  /**
   * 每个邮箱最多注册账号数
   */
  maxAccountsPerEmail: number;
  /**
   * 默认用户组标识
   */
  defaultGroupUsername: string;
  /**
   * 验证码有效期（秒）
   */
  verificationCodeExpiry: number;
}

export interface SetRelayConfigDto {
  upstreamUrl: string;
  upstreamApiKey: string;
  allowedModels: string;
  customKeyEnabled: boolean;
  customKeyMaxTokensPerUser: number;
  customKeyCreateLimitWindowMinutes: number;
  customKeyCreateLimitMaxCount: number;
}

export interface RelayProxyConfigDto {
  enabled: boolean;
  url: string;
}

export type SetRelayProxyConfigDto = RelayProxyConfigDto

export interface SetSmtpConfigDto {
  /**
   * SMTP 服务器地址
   */
  host: string;
  /**
   * 端口号
   */
  port: number;
  secure: boolean;
  user: string;
  password: string;
  /**
   * 发件人显示名称
   */
  senderName: string;
  /**
   * 发件人邮箱
   */
  senderEmail: string;
}

export interface NotificationConfigDto {
  defaultSubscribedEvents: string[];
  defaultThresholds: Record<string, number>;
  ticketAssignmentRules: TicketAssignmentRuleDto[];
}

export interface TicketAssignmentRuleDto {
  type?: string;
  priority?: string;
  assigneeUserIds: string[];
}

export interface SetNotificationConfigDto {
  defaultSubscribedEvents: string[];
  defaultThresholds: Record<string, number>;
  ticketAssignmentRules: TicketAssignmentRuleDto[];
}

export interface SetIpBanConfigDto {
  enabled: boolean;
  level1Threshold: number;
  /**
   * 封禁时长（秒），-1 永久
   */
  level1Duration: number;
  level2Threshold: number;
  level2Duration: number;
  level3Threshold: number;
  level3Duration: number;
}

export interface SetModelConfigDto {
  allowedModels: string;
}
