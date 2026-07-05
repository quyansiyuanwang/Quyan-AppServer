import { CustomCode } from "@/constant/custom-code";
import en from "./en";
import zhCN from "./zh-CN";
import type { Assert, DeepStringify, Equal, NestedKeys, ParamsForKey, TranslationParams } from "./types";

export type { TranslationParams } from "./types";

export const SUPPORTED_BACKEND_LOCALES = ["zh-CN", "en"] as const;
export type BackendLocale = (typeof SUPPORTED_BACKEND_LOCALES)[number];

export const DEFAULT_BACKEND_LOCALE: BackendLocale = "en";
export const LOCALE_HEADER_NAME = "x-locale";

type BackendMessages = typeof en;
type LocaleMessages = DeepStringify<BackendMessages>;
export type MessageKey = NestedKeys<BackendMessages>;
type EnKeys = NestedKeys<typeof en>;
type ZhCNKeys = NestedKeys<typeof zhCN>;
type _AssertLocaleKeys = Assert<Equal<EnKeys, ZhCNKeys>>;
type MessageParams<TKey extends MessageKey> = MessageKey extends TKey
  ? TranslationParams
  : ParamsForKey<BackendMessages, TKey>;
void (0 as unknown as _AssertLocaleKeys);

const catalogs = {
  en,
  "zh-CN": zhCN,
} satisfies Record<BackendLocale, LocaleMessages>;

const zhCNKnownMessages = {
  用户名已存在: "用户名已存在",
  默认用户组不存在: "默认用户组不存在",
  用户不存在: "用户不存在",
  用户信息不存在: "用户信息不存在",
  新邮箱不能与当前邮箱相同: "新邮箱不能与当前邮箱相同",
  该邮箱已被其他用户使用: "该邮箱已被其他用户使用",
  "每天只能修改一次邮箱，请明天再试": "每天只能修改一次邮箱，请明天再试",
  验证码无效或已过期: "验证码无效或已过期",
  无效的二次验证配置会话: "无效的二次验证配置会话",
  二次验证码错误: "二次验证码错误",
  二次验证未开启: "二次验证未开启",
  建议开启二次验证以提升账号安全: "建议开启二次验证以提升账号安全",
  "当前账号未绑定邮箱，无法使用邮箱验证码": "当前账号未绑定邮箱，无法使用邮箱验证码",
  验证码已发送: "验证码已发送",
  二次验证失败: "二次验证失败",
  邮箱验证码错误: "邮箱验证码错误",
  恢复码错误: "恢复码错误",
  二次验证配置会话已过期: "二次验证配置会话已过期",
  二次验证会话已过期: "二次验证会话已过期",
  "请求过于频繁，请稍后再试": "请求过于频繁，请稍后再试",
  "登录会话不存在，请重新登录": "登录会话不存在，请重新登录",
  "用户已被强制下线，请重新登录": "用户已被强制下线，请重新登录",
  "当前会话已被强制结束，请重新登录": "当前会话已被强制结束，请重新登录",
  不能在模拟会话中发起另一个模拟: "不能在模拟会话中发起另一个模拟",
  不能模拟自己: "不能模拟自己",
  操作者用户不存在: "操作者用户不存在",
  目标用户不存在: "目标用户不存在",
  无法模拟权限等级不低于自身的用户: "无法模拟权限等级不低于自身的用户",
  无模拟权限: "无模拟权限",
  未授权访问: "未授权访问",
  权限不足: "权限不足",
  不允许修改自己的权限: "不允许修改自己的权限",
  无权修改等级大于或等于自己的用户的权限: "无权修改等级大于或等于自己的用户的权限",
  用户组不存在: "用户组不存在",
  组标识已存在: "组标识已存在",
  该用户组不允许删除: "该用户组不允许删除",
  "该组下仍有用户，无法删除": "该组下仍有用户，无法删除",
  "SMTP 未配置": "SMTP 未配置",
  用户邮箱不存在: "用户邮箱不存在",
  "缺少人机验证 token": "缺少人机验证 token",
  "人机验证服务暂时不可用，请稍后重试": "人机验证服务暂时不可用，请稍后重试",
  "人机验证失败，请刷新页面重试": "人机验证失败，请刷新页面重试",
  "人机验证未通过，请稍后重试": "人机验证未通过，请稍后重试",
  人机验证失败: "人机验证失败",
  接口不存在: "接口不存在",
  不能修改同级或更高级别的用户: "不能修改同级或更高级别的用户",
  不能删除自己: "不能删除自己",
  不能删除同级或更高级别的用户: "不能删除同级或更高级别的用户",
  删除成功: "删除成功",
  密码修改成功: "密码修改成功",
  邮箱修改成功: "邮箱修改成功",
  "2FA trusted window 已清理": "2FA trusted window 已清理",
  注册成功: "注册成功",
  请先同意服务协议和隐私政策: "请先同意服务协议和隐私政策",
  注册功能未开启: "注册功能未开启",
  该邮箱已达注册上限: "该邮箱已达注册上限",
  用户名与邮箱不匹配: "用户名与邮箱不匹配",
  密码重置成功: "密码重置成功",
  密码重置验证码已发送: "密码重置验证码已发送",
  登出成功: "登出成功",
  权限配置更新成功: "权限配置更新成功",
  权限添加成功: "权限添加成功",
  权限移除成功: "权限移除成功",
  权限配置已清空: "权限配置已清空",
  用户组权限设置成功: "用户组权限设置成功",
  权限更新成功: "权限更新成功",
  配置更新成功: "配置更新成功",
  渠道删除成功: "渠道删除成功",
  Token删除成功: "Token 删除成功",
  pong: "pong",
  缺少防重放请求头: "缺少防重放请求头",
  无效的时间戳: "无效的时间戳",
  请求已过期: "请求已过期",
  "签名会话无效，请重试": "签名会话无效，请重试",
  "签名会话已过期，请重试": "签名会话已过期，请重试",
  签名会话校验失败: "签名会话校验失败",
  签名验证失败: "签名验证失败",
  请求已被使用: "请求已被使用",
  需要先完成人机验证: "需要先完成人机验证",
  "缺少 captcha token": "缺少 captcha token",
  "ReURL 已过期或无效": "ReURL 已过期或无效",
  只读模拟模式下不允许执行写操作: "只读模拟模式下不允许执行写操作",
  "Token版本过旧，请重新登录": "Token版本过旧，请重新登录",
  "用户信息已更新，请重新登录": "用户信息已更新，请重新登录",
  "服务协议或隐私政策尚未发布，暂时无法完成当前操作": "服务协议或隐私政策尚未发布，暂时无法完成当前操作",
  "协议确认会话已过期，请重新登录": "协议确认会话已过期，请重新登录",
  "协议确认会话无效，请重新登录": "协议确认会话无效，请重新登录",
  需要同意最新服务协议和隐私政策: "需要同意最新服务协议和隐私政策",
  用户名或密码错误: "用户名或密码错误",
  缺少刷新令牌: "缺少刷新令牌",
  无效的刷新令牌: "无效的刷新令牌",
  无效的访问令牌: "无效的访问令牌",
  Success: "成功",
  操作成功: "操作成功",
  "账号已被禁用，请联系管理员": "账号已被禁用，请联系管理员",
  账号已被删除: "账号已被删除",
  账号状态异常: "账号状态异常",
  "您的 IP 地址已被封禁": "您的 IP 地址已被封禁",
  "Monthly pass template deleted": "月卡模板删除成功",
  "User monthly pass deleted": "用户月卡删除成功",
  不能创建同级或更高级别的组: "不能创建同级或更高级别的组",
  不能修改同级或更高级别的组: "不能修改同级或更高级别的组",
  不能将组级别设置为同级或更高: "不能将组级别设置为同级或更高",
  不能删除同级或更高级别的组: "不能删除同级或更高级别的组",
  不能修改同级或更高级别组的权限: "不能修改同级或更高级别组的权限",
  "权限不足，无法添加权限": "权限不足，无法添加权限",
  "权限不足，无法移除权限": "权限不足，无法移除权限",
  法律协议版本不存在: "法律协议版本不存在",
  "已发布的协议版本不允许修改，请新建版本": "已发布的协议版本不允许修改，请新建版本",
  已发布的协议版本不允许删除: "已发布的协议版本不允许删除",
  该协议版本已发布: "该协议版本已发布",
  "该协议版本尚未发布，无需撤销发布": "该协议版本尚未发布，无需撤销发布",
  "撤销后将导致当前协议类型无有效协议，无法执行撤销发布": "撤销后将导致当前协议类型无有效协议，无法执行撤销发布",
  当前已发布协议不存在: "当前已发布协议不存在",
  当前服务协议或隐私政策尚未完整发布: "当前服务协议或隐私政策尚未完整发布",
  "当前协议类型已有未发布草稿，请先更新或发布现有草稿": "当前协议类型已有未发布草稿，请先更新或发布现有草稿",
  "创建协议版本冲突，请刷新后重试": "创建协议版本冲突，请刷新后重试",
  "Slug 仅允许小写字母、数字、连字符和下划线": "Slug 仅允许小写字母、数字、连字符和下划线",
  "Slug 已被使用": "Slug 已被使用",
  非公开端点必须设置访问密码: "非公开端点必须设置访问密码",
  端点不存在: "端点不存在",
  无权访问此端点: "无权访问此端点",
  无权修改此端点: "无权修改此端点",
  无权删除此端点: "无权删除此端点",
  此端点需要访问密码: "此端点需要访问密码",
  端点配置错误: "端点配置错误",
  密码错误: "密码错误",
  "Invalid AccessKey": "无效的 AccessKey",
  "AccessKey expired": "AccessKey 已过期",
  "AccessKey not found": "AccessKey 不存在",
  "Slug already exists": "Slug 已存在",
  "Article not found": "文章不存在",
  "You can only update your own articles": "只能更新自己的文章",
  "You can only delete your own articles": "只能删除自己的文章",
  "Article is already published": "文章已发布",
  "Article is already a draft": "文章已经是草稿状态",
  "You cannot access draft articles": "不能访问草稿文章",
  "You do not have permission to access this article": "无权访问该文章",
  "Public articles cannot require permissions": "公开文章不能设置访问权限",
  "This article is not public": "该文章不是公开文章",
  "Only published articles can be set as default": "只有已发布文章才能设置为默认",
  兑换码不存在: "兑换码不存在",
  兑换码已被使用: "兑换码已被使用",
  兑换码已过期: "兑换码已过期",
} as const;

const enKnownMessages: Record<keyof typeof zhCNKnownMessages, string> = {
  用户名已存在: "Username already exists",
  默认用户组不存在: "Default user group does not exist",
  用户不存在: "User does not exist",
  用户信息不存在: "User information does not exist",
  新邮箱不能与当前邮箱相同: "The new email cannot be the same as the current email",
  该邮箱已被其他用户使用: "This email is already used by another user",
  "每天只能修改一次邮箱，请明天再试": "Email can only be changed once per day, please try again tomorrow",
  验证码无效或已过期: "Verification code is invalid or expired",
  无效的二次验证配置会话: "Invalid two-factor setup session",
  二次验证码错误: "Invalid two-factor code",
  二次验证未开启: "Two-factor verification is not enabled",
  建议开启二次验证以提升账号安全: "Enable two-factor verification to improve account security",
  "当前账号未绑定邮箱，无法使用邮箱验证码": "This account has no bound email and cannot use email verification codes",
  验证码已发送: "Verification code sent",
  二次验证失败: "Two-factor verification failed",
  邮箱验证码错误: "Invalid email verification code",
  恢复码错误: "Invalid recovery code",
  二次验证配置会话已过期: "Two-factor setup session has expired",
  二次验证会话已过期: "Two-factor session has expired",
  "请求过于频繁，请稍后再试": "Too many requests, please try again later",
  "登录会话不存在，请重新登录": "Login session does not exist, please log in again",
  "用户已被强制下线，请重新登录": "User was forced offline, please log in again",
  "当前会话已被强制结束，请重新登录": "Current session was terminated, please log in again",
  不能在模拟会话中发起另一个模拟: "Cannot start another impersonation inside an impersonated session",
  不能模拟自己: "Cannot impersonate yourself",
  操作者用户不存在: "Operator user does not exist",
  目标用户不存在: "Target user does not exist",
  无法模拟权限等级不低于自身的用户: "Cannot impersonate a user whose privilege level is not lower than yours",
  无模拟权限: "No impersonation permission",
  未授权访问: "Unauthorized access",
  权限不足: "Insufficient permissions",
  不允许修改自己的权限: "You cannot modify your own permissions",
  无权修改等级大于或等于自己的用户的权限: "You cannot modify permissions of users at or above your own level",
  用户组不存在: "User group does not exist",
  组标识已存在: "Group identifier already exists",
  该用户组不允许删除: "This user group cannot be deleted",
  "该组下仍有用户，无法删除": "This group still has users and cannot be deleted",
  "SMTP 未配置": "SMTP is not configured",
  用户邮箱不存在: "User email does not exist",
  "缺少人机验证 token": "Missing CAPTCHA token",
  "人机验证服务暂时不可用，请稍后重试": "CAPTCHA service is temporarily unavailable, please try again later",
  "人机验证失败，请刷新页面重试": "CAPTCHA verification failed, please refresh and try again",
  "人机验证未通过，请稍后重试": "CAPTCHA verification did not pass, please try again later",
  人机验证失败: "CAPTCHA verification failed",
  接口不存在: "Endpoint not found",
  不能修改同级或更高级别的用户: "Cannot modify a user at the same or higher level",
  不能删除自己: "Cannot delete yourself",
  不能删除同级或更高级别的用户: "Cannot delete a user at the same or higher level",
  删除成功: "Deleted successfully",
  密码修改成功: "Password changed successfully",
  邮箱修改成功: "Email changed successfully",
  "2FA trusted window 已清理": "2FA trusted window cleared",
  注册成功: "Registration successful",
  请先同意服务协议和隐私政策: "Please accept the terms of service and privacy policy first",
  注册功能未开启: "Registration is disabled",
  该邮箱已达注册上限: "This email has reached the registration limit",
  用户名与邮箱不匹配: "Username and email do not match",
  密码重置成功: "Password reset successfully",
  密码重置验证码已发送: "Password reset verification code sent",
  登出成功: "Logged out successfully",
  权限配置更新成功: "Permission configuration updated successfully",
  权限添加成功: "Permissions added successfully",
  权限移除成功: "Permissions removed successfully",
  权限配置已清空: "Permission configuration cleared",
  用户组权限设置成功: "Group permissions set successfully",
  权限更新成功: "Permissions updated successfully",
  配置更新成功: "Configuration updated successfully",
  渠道删除成功: "Channel deleted successfully",
  Token删除成功: "Token deleted successfully",
  pong: "pong",
  缺少防重放请求头: "Missing replay protection headers",
  无效的时间戳: "Invalid timestamp",
  请求已过期: "Request expired",
  "签名会话无效，请重试": "Invalid signing session, please try again",
  "签名会话已过期，请重试": "Signing session expired, please try again",
  签名会话校验失败: "Signing session validation failed",
  签名验证失败: "Signature verification failed",
  请求已被使用: "Request has already been used",
  需要先完成人机验证: "CAPTCHA verification is required first",
  "缺少 captcha token": "Missing captcha token",
  "ReURL 已过期或无效": "ReURL is expired or invalid",
  只读模拟模式下不允许执行写操作: "Write operations are not allowed in read-only impersonation mode",
  "Token版本过旧，请重新登录": "Token version is too old, please log in again",
  "用户信息已更新，请重新登录": "User information has been updated, please log in again",
  "服务协议或隐私政策尚未发布，暂时无法完成当前操作": "Terms of service or privacy policy have not been published yet",
  "协议确认会话已过期，请重新登录": "Policy consent session expired, please log in again",
  "协议确认会话无效，请重新登录": "Invalid policy consent session, please log in again",
  需要同意最新服务协议和隐私政策: "You must accept the latest terms of service and privacy policy",
  用户名或密码错误: "Invalid username or password",
  缺少刷新令牌: "Missing refresh token",
  无效的刷新令牌: "Invalid refresh token",
  无效的访问令牌: "Invalid access token",
  Success: "Success",
  操作成功: "Operation successful",
  "账号已被禁用，请联系管理员": "Account is disabled, please contact the administrator",
  账号已被删除: "Account has been deleted",
  账号状态异常: "Abnormal account status",
  "您的 IP 地址已被封禁": "Your IP address has been blocked",
  "Monthly pass template deleted": "Monthly pass template deleted",
  "User monthly pass deleted": "User monthly pass deleted",
  不能创建同级或更高级别的组: "Cannot create a group at the same or higher level",
  不能修改同级或更高级别的组: "Cannot modify a group at the same or higher level",
  不能将组级别设置为同级或更高: "Cannot set the group level to the same or higher level",
  不能删除同级或更高级别的组: "Cannot delete a group at the same or higher level",
  不能修改同级或更高级别组的权限: "Cannot modify permissions of a group at the same or higher level",
  "权限不足，无法添加权限": "Insufficient permissions to add permissions",
  "权限不足，无法移除权限": "Insufficient permissions to remove permissions",
  法律协议版本不存在: "Legal policy version does not exist",
  "已发布的协议版本不允许修改，请新建版本": "Published policy versions cannot be modified, please create a new version",
  已发布的协议版本不允许删除: "Published policy versions cannot be deleted",
  该协议版本已发布: "This policy version is already published",
  "该协议版本尚未发布，无需撤销发布": "This policy version is not published and does not need to be unpublished",
  "撤销后将导致当前协议类型无有效协议，无法执行撤销发布":
    "Unpublishing would leave this policy type without an active version",
  当前已发布协议不存在: "No currently published policies exist",
  当前服务协议或隐私政策尚未完整发布: "The current terms of service or privacy policy are not fully published",
  "当前协议类型已有未发布草稿，请先更新或发布现有草稿": "There is already an unpublished draft for this policy type",
  "创建协议版本冲突，请刷新后重试": "Policy version creation conflict, please refresh and try again",
  "Slug 仅允许小写字母、数字、连字符和下划线":
    "Slug may only contain lowercase letters, numbers, hyphens, and underscores",
  "Slug 已被使用": "Slug is already in use",
  非公开端点必须设置访问密码: "A non-public endpoint must have an access password",
  端点不存在: "Endpoint does not exist",
  无权访问此端点: "No permission to access this endpoint",
  无权修改此端点: "No permission to modify this endpoint",
  无权删除此端点: "No permission to delete this endpoint",
  此端点需要访问密码: "This endpoint requires an access password",
  端点配置错误: "Endpoint configuration error",
  密码错误: "Incorrect password",
  "Invalid AccessKey": "Invalid AccessKey",
  "AccessKey expired": "AccessKey expired",
  "AccessKey not found": "AccessKey not found",
  "Slug already exists": "Slug already exists",
  "Article not found": "Article not found",
  "You can only update your own articles": "You can only update your own articles",
  "You can only delete your own articles": "You can only delete your own articles",
  "Article is already published": "Article is already published",
  "Article is already a draft": "Article is already a draft",
  "You cannot access draft articles": "You cannot access draft articles",
  "You do not have permission to access this article": "You do not have permission to access this article",
  "Public articles cannot require permissions": "Public articles cannot require permissions",
  "This article is not public": "This article is not public",
  "Only published articles can be set as default": "Only published articles can be set as default",
  兑换码不存在: "Redemption code does not exist",
  兑换码已被使用: "Redemption code has already been used",
  兑换码已过期: "Redemption code has expired",
};

const knownMessageCatalogs = {
  "zh-CN": zhCNKnownMessages,
  en: enKnownMessages,
} as const;

const codeMessageKeyMap: Partial<Record<CustomCode, MessageKey>> = {
  [CustomCode.AUTH_FAILED]: "errors.unauthorized",
  [CustomCode.VALIDATION_FAILED]: "errors.validationFailed",
  [CustomCode.NOT_FOUND]: "errors.notFound",
  [CustomCode.PERMISSION_DENIED]: "errors.forbidden",
  [CustomCode.INTERNAL_SERVER_ERROR]: "errors.internalServerError",
  [CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE]: "errors.tokenExpiredDueToUpdate",
  [CustomCode.ACCOUNT_DISABLED]: "errors.accountDisabled",
  [CustomCode.REGISTRATION_DISABLED]: "errors.registrationDisabled",
  [CustomCode.EMAIL_LIMIT_REACHED]: "errors.emailLimitReached",
  [CustomCode.VERIFICATION_CODE_INVALID]: "errors.verificationCodeInvalid",
  [CustomCode.SMTP_NOT_CONFIGURED]: "errors.smtpNotConfigured",
  [CustomCode.IP_BLACKLISTED]: "errors.ipBlacklisted",
  [CustomCode.TOKEN_EXPIRED]: "errors.tokenExpired",
  [CustomCode.TOKEN_INVALID]: "errors.invalidToken",
  [CustomCode.LOGIN_AUTH_FAILED]: "errors.loginAuthFailed",
  [CustomCode.TOO_MANY_REQUESTS]: "errors.tooManyRequests",
  [CustomCode.REQUIRE_REPLAY_PROTECTION]: "errors.requireReplayProtection",
  [CustomCode.REPLAY_PROTECTION_FAILED]: "errors.replayProtectionFailed",
  [CustomCode.TWO_FACTOR_REQUIRED]: "errors.twoFactorRequired",
  [CustomCode.TWO_FACTOR_CHALLENGE_EXPIRED]: "errors.twoFactorChallengeExpired",
  [CustomCode.TWO_FACTOR_CODE_INVALID]: "errors.twoFactorCodeInvalid",
  [CustomCode.TWO_FACTOR_SETUP_SESSION_EXPIRED]: "errors.twoFactorSetupSessionExpired",
  [CustomCode.TWO_FACTOR_NOT_ENABLED]: "errors.twoFactorNotEnabled",
  [CustomCode.TWO_FACTOR_ALREADY_ENABLED]: "errors.twoFactorAlreadyEnabled",
  [CustomCode.DISTRIBUTED_LOCK_CONFLICT]: "errors.lockConflict",
  [CustomCode.DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE]: "errors.lockBackendUnavailable",
  [CustomCode.IMPERSONATION_READONLY_VIOLATION]: "errors.impersonationReadonlyViolation",
  [CustomCode.IMPERSONATION_NOT_ALLOWED]: "errors.impersonationNotAllowed",
  [CustomCode.POLICY_CONSENT_REQUIRED]: "errors.policyConsentRequired",
  [CustomCode.LEGAL_POLICY_VERSION_CONFLICT]: "errors.legalPolicyVersionConflict",
  [CustomCode.RESOURCE_ALREADY_EXISTS]: "errors.resourceAlreadyExists",
  [CustomCode.CAPTCHA_TRUST_REQUIRED]: "errors.captchaTrustRequired",
};

export interface MessageDescriptor {
  key: MessageKey;
  params?: TranslationParams;
  fallback?: string;
}

export interface MessageErrorOptions {
  messageKey: MessageKey;
  messageParams?: TranslationParams;
}

function getNestedMessage(catalog: LocaleMessages, key: MessageKey): string | undefined {
  const value = key.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, catalog);

  return typeof value === "string" ? value : undefined;
}

export function createMessageDescriptor<TKey extends MessageKey>(
  key: TKey,
  params?: MessageParams<TKey>,
  fallback?: string,
): MessageDescriptor {
  return { key, params, fallback } as MessageDescriptor;
}

export function createMessageOptions<TKey extends MessageKey>(
  key: TKey,
  params?: MessageParams<TKey>,
): MessageErrorOptions {
  return { messageKey: key, messageParams: params } as MessageErrorOptions;
}

export function normalizeBackendLocale(locale?: string | null): BackendLocale {
  if (!locale) return DEFAULT_BACKEND_LOCALE;

  const normalized = locale.trim();
  if (!normalized) return DEFAULT_BACKEND_LOCALE;
  if (normalized === "zh-CN" || normalized.toLowerCase() === "zh-cn") return "zh-CN";
  if (normalized === "en" || normalized.toLowerCase().startsWith("en")) return "en";

  return DEFAULT_BACKEND_LOCALE;
}

export function translateMessage<TKey extends MessageKey>(
  key: TKey,
  locale: BackendLocale,
  params?: MessageParams<TKey>,
  fallback?: string,
): string {
  const template =
    getNestedMessage(catalogs[locale], key) ??
    getNestedMessage(catalogs[DEFAULT_BACKEND_LOCALE], key) ??
    fallback ??
    key;
  if (!params) return template;

  return template.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_match, token: string) => {
    const value = params[token];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function getMessageKeyForCustomCode(code?: number): MessageKey | undefined {
  if (code === undefined) return undefined;
  return codeMessageKeyMap[code as CustomCode];
}

export function translateDescriptor(descriptor: MessageDescriptor, locale: BackendLocale): string {
  return translateMessage(descriptor.key, locale, descriptor.params, descriptor.fallback);
}

export const backendI18n = {
  t: translateMessage,
  descriptor: createMessageDescriptor,
  errorOptions: createMessageOptions,
} as const;

export function translateKnownMessage(message: string, locale: BackendLocale): string {
  const exact = knownMessageCatalogs[locale][message as keyof typeof zhCNKnownMessages];
  if (exact) return exact;

  const fallback = knownMessageCatalogs[DEFAULT_BACKEND_LOCALE][message as keyof typeof zhCNKnownMessages];
  if (fallback)
    return locale === DEFAULT_BACKEND_LOCALE
      ? fallback
      : knownMessageCatalogs[locale][message as keyof typeof zhCNKnownMessages] || fallback;

  const invalidPermissionsPrefix = "无效的权限: ";
  if (message.startsWith(invalidPermissionsPrefix)) {
    const suffix = message.slice(invalidPermissionsPrefix.length);
    return locale === "en" ? `Invalid permissions: ${suffix}` : message;
  }

  const missingPermissionsPrefix = "缺少必要权限: ";
  if (message.startsWith(missingPermissionsPrefix)) {
    const suffix = message.slice(missingPermissionsPrefix.length);
    return locale === "en" ? `Missing required permissions: ${suffix}` : message;
  }

  const anyPermissionPrefix = "需要以下权限之一: ";
  if (message.startsWith(anyPermissionPrefix)) {
    const suffix = message.slice(anyPermissionPrefix.length);
    return locale === "en" ? `Requires one of the following permissions: ${suffix}` : message;
  }

  const unauthorizedPrefix = "Unauthorized: ";
  if (message.startsWith(unauthorizedPrefix)) {
    const suffix = message.slice(unauthorizedPrefix.length);
    return locale === "en" ? message : `未授权：${suffix}`;
  }

  return message;
}
