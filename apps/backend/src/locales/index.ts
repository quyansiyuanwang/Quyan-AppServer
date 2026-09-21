import en from "./en";
import zhCN from "./zh-CN";
import type {
  Assert,
  DeepStringify,
  DescriptorRestArgs,
  Equal,
  ExtractDoubleBraceKeys,
  NestedKeys,
  ParamsForKey,
  PathValue,
  TranslationParams,
} from "./types";

export type { TranslationParams, MessageParamValue } from "./types";

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

/**
 * 某个 key 在给定语言目录中的模板占位符集合（按 key 分发，联合 key 取并集）。
 */
type PlaceholdersForKey<TMessages, TKey extends string> = TKey extends unknown
  ? ExtractDoubleBraceKeys<Extract<PathValue<TMessages, TKey>, string>>
  : never;

/**
 * 占位符一致性硬约束：同一个 key 在 en 与 zh-CN 中必须使用相同的占位符集合。
 *
 * 若译文写成 `{{ip}}` 而英文是 `{{IP}}`（或漏写/多写占位符），插值时就会渲染出空值或残留
 * `{{...}}`。这条断言让不一致在 `tsc` 阶段失败，而不是等到线上。
 *
 * 刻意逐 key 比较后再断言结果为 `never`：直接对两个映射类型做整体 `Equal` 会因类型仍处于
 * 延迟求值状态而误判为不相等；逐 key 形式还会在报错信息里列出**具体是哪些 key** 不一致。
 */
type PlaceholderMismatches = {
  [K in MessageKey]: Equal<PlaceholdersForKey<BackendMessages, K>, PlaceholdersForKey<typeof zhCN, K>> extends true
    ? never
    : K;
}[MessageKey];
/** 约束为 `never`，使报错信息直接列出占位符不一致的具体 key */
type AssertNever<T extends never> = T;
type _AssertLocalePlaceholders = AssertNever<PlaceholderMismatches>;

/**
 * 某个 key 的精确参数类型。
 *
 * - 字面量 key → 该模板占位符的精确记录（无占位符时为 `undefined`）
 * - 已退化为整个 `MessageKey` 联合 → 宽松 `TranslationParams`，避免展开数百个 key
 */
export type MessageParamsForKey<TKey extends MessageKey> = MessageKey extends TKey
  ? TranslationParams | undefined
  : ParamsForKey<BackendMessages, TKey>;

/** 某个 key 对参数的要求，用于把「必须传参 / 不接受参数」落到编译期 */
export type MessageRequirementForKey<TKey extends MessageKey> = MessageKey extends TKey
  ? "loose"
  : [Exclude<MessageParamsForKey<TKey>, undefined>] extends [never]
    ? "forbidden"
    : "required";

type DescriptorArgs<TKey extends MessageKey> = DescriptorRestArgs<
  MessageRequirementForKey<TKey>,
  MessageParamsForKey<TKey>
>;

void (0 as unknown as _AssertLocaleKeys);
void (0 as unknown as _AssertLocalePlaceholders);

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

/**
 * 遗留原文反查目录中的条目快照（只读）。
 *
 * 仅供「禁止新增旧式调用」的静态门禁与迁移进度统计使用；正式翻译路径一律走 `MessageKey`。
 * 该目录本身在 P13 删除，届时本函数一并移除。
 */
export function getLegacyRawMessageEntries(locale: BackendLocale): readonly string[] {
  return Object.keys(knownMessageCatalogs[locale]);
}

export interface MessageDescriptor<TKey extends MessageKey = MessageKey> {
  key: TKey;
  params?: TranslationParams;
  fallback?: string;
}

/** 描述符在运行时暴露的问题；出口据此回退并记录受控诊断，不向用户展示 key 或残留占位符 */
export interface MessageDescriptorIssue {
  kind: "unknownKey" | "missingParam" | "unusableFallback";
  key: string;
  detail: string;
}

export type MessageErrorOptions<TKey extends MessageKey = MessageKey> =
  MessageRequirementForKey<TKey> extends "required"
    ? { messageKey: TKey; messageParams: MessageParamsForKey<TKey> }
    : { messageKey: TKey; messageParams?: MessageParamsForKey<TKey> };

function getNestedMessage(catalog: LocaleMessages, key: MessageKey): string | undefined {
  const value = key.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, catalog);

  return typeof value === "string" ? value : undefined;
}

const PLACEHOLDER_PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g;

function extractPlaceholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
}

/**
 * 创建类型安全的消息描述符。
 *
 * 编译期约束：带占位符的 key 必须提供匹配参数；无占位符的 key 不接受参数。
 */
export function createMessageDescriptor<TKey extends MessageKey>(
  key: TKey,
  ...rest: DescriptorArgs<TKey>
): MessageDescriptor<TKey> {
  const [params, fallback] = rest as [TranslationParams | undefined, string | undefined];
  return { key, params, fallback };
}

/**
 * 创建类型安全的错误消息选项，供 `ApiErrorOptions` 与调用链复用。
 *
 * 与 `createMessageDescriptor` 使用同一套 key/params 约束，避免出现第二套弱类型入口。
 */
export function createMessageOptions<TKey extends MessageKey>(
  key: TKey,
  ...rest: DescriptorArgs<TKey>
): MessageErrorOptions<TKey> {
  const [params] = rest as [TranslationParams | undefined];
  return { messageKey: key, messageParams: params } as MessageErrorOptions<TKey>;
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
  params?: MessageParamsForKey<TKey>,
  fallback?: string,
): string {
  const template =
    getNestedMessage(catalogs[locale], key) ??
    getNestedMessage(catalogs[DEFAULT_BACKEND_LOCALE], key) ??
    fallback ??
    key;
  if (!params) return template;

  let values: TranslationParams | undefined;
  if (params) values = params as TranslationParams;

  return template.replace(PLACEHOLDER_PATTERN, (_match, token: string) => {
    const value = values?.[token];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function translateDescriptor(descriptor: MessageDescriptor, locale: BackendLocale): string {
  return translateMessage(descriptor.key, locale, descriptor.params, descriptor.fallback);
}

/**
 * 检查描述符在运行时可安全渲染，返回问题清单而不抛异常。
 *
 * 调用方（响应出口）据此记录受控诊断并回退，绝不把消息 key 或 `{{param}}` 残留展示给用户。
 */
export function inspectMessageDescriptor(descriptor: MessageDescriptor): MessageDescriptorIssue[] {
  const issues: MessageDescriptorIssue[] = [];
  const template = getNestedMessage(catalogs[DEFAULT_BACKEND_LOCALE], descriptor.key);

  if (template === undefined) {
    issues.push({
      kind: "unknownKey",
      key: descriptor.key,
      detail: "Message key is not present in the default catalog",
    });
    return issues;
  }

  for (const placeholder of extractPlaceholders(template)) {
    const value = descriptor.params?.[placeholder];
    if (value === undefined || value === null)
      issues.push({
        kind: "missingParam",
        key: descriptor.key,
        detail: `Missing value for placeholder "${placeholder}"`,
      });
  }

  return issues;
}

export interface RenderedMessage {
  message: string;
  issues: MessageDescriptorIssue[];
  /** 是否使用了安全兜底（真实 key / 缺失参数被替换为通用安全消息） */
  usedSafeFallback: boolean;
}

/**
 * 渲染描述符并在运行时异常时使用安全本地化兜底。
 *
 * 未知 key 或缺失参数不会把 key、占位符或原始异常暴露给用户，而是回退到通用安全消息。
 */
export function renderDescriptorSafely(descriptor: MessageDescriptor, locale: BackendLocale): RenderedMessage {
  const issues = inspectMessageDescriptor(descriptor);
  if (issues.length === 0) return { message: translateDescriptor(descriptor, locale), issues, usedSafeFallback: false };

  return {
    message: translateMessage("errors.internalServerError", locale),
    issues,
    usedSafeFallback: true,
  };
}

export const backendI18n = {
  t: translateMessage,
  descriptor: createMessageDescriptor,
  errorOptions: createMessageOptions,
  inspect: inspectMessageDescriptor,
  renderSafely: renderDescriptorSafely,
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
