/**
 * Notification event types for the Event Center
 */
export enum NotificationEvent {
  // Billing & quota
  BALANCE_LOW = "balance_low",
  RECHARGE_SUCCESS = "recharge_success",
  REDEMPTION_SUCCESS = "redemption_success",
  MONTHLY_PASS_QUOTA_LOW = "monthly_pass_quota_low",
  MONTHLY_PASS_DAILY_LIMIT = "monthly_pass_daily_limit",
  RELAY_TOKEN_QUOTA_LOW = "relay_token_quota_low",
  RELAY_TOKEN_EXHAUSTED = "relay_token_exhausted",
  FEEDBACK_STATUS_UPDATED = "feedback_status_updated",
  FEEDBACK_PUBLIC_REPLY = "feedback_public_reply",
  FEEDBACK_ASSIGNED = "feedback_assigned",
  // Security
  ABNORMAL_LOGIN = "abnormal_login",
  LOGIN_FAILED_MULTIPLE = "login_failed_multiple",
  PASSWORD_CHANGED = "password_changed",
  TWO_FACTOR_STATUS_CHANGE = "two_factor_status_change",
  ACCOUNT_STATUS_CHANGED = "account_status_changed",
}

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  [NotificationEvent.BALANCE_LOW]: "余额不足",
  [NotificationEvent.RECHARGE_SUCCESS]: "充值成功",
  [NotificationEvent.REDEMPTION_SUCCESS]: "兑换码兑换成功",
  [NotificationEvent.MONTHLY_PASS_QUOTA_LOW]: "月卡额度不足",
  [NotificationEvent.MONTHLY_PASS_DAILY_LIMIT]: "月卡即将达到日限额",
  [NotificationEvent.RELAY_TOKEN_QUOTA_LOW]: "中转令牌即将限额",
  [NotificationEvent.RELAY_TOKEN_EXHAUSTED]: "中转令牌额度耗尽",
  [NotificationEvent.FEEDBACK_STATUS_UPDATED]: "反馈状态更新",
  [NotificationEvent.FEEDBACK_PUBLIC_REPLY]: "反馈收到回复",
  [NotificationEvent.FEEDBACK_ASSIGNED]: "反馈工单已分配",
  [NotificationEvent.ABNORMAL_LOGIN]: "账户异常登录",
  [NotificationEvent.LOGIN_FAILED_MULTIPLE]: "多次登录失败",
  [NotificationEvent.PASSWORD_CHANGED]: "密码已修改",
  [NotificationEvent.TWO_FACTOR_STATUS_CHANGE]: "2FA 状态变更",
  [NotificationEvent.ACCOUNT_STATUS_CHANGED]: "账户状态变更",
};

/**
 * Events that support user-defined thresholds
 */
export const THRESHOLD_EVENTS = [
  NotificationEvent.BALANCE_LOW,
  NotificationEvent.MONTHLY_PASS_QUOTA_LOW,
  NotificationEvent.MONTHLY_PASS_DAILY_LIMIT,
  NotificationEvent.RELAY_TOKEN_QUOTA_LOW,
] as const;

export const ALL_NOTIFICATION_EVENTS = Object.values(NotificationEvent);
