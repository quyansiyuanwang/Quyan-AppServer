export enum NotificationEvent {
  // Billing & quota
  BALANCE_LOW = 'balance_low',
  RECHARGE_SUCCESS = 'recharge_success',
  REDEMPTION_SUCCESS = 'redemption_success',
  MONTHLY_PASS_QUOTA_LOW = 'monthly_pass_quota_low',
  MONTHLY_PASS_DAILY_LIMIT = 'monthly_pass_daily_limit',
  RELAY_TOKEN_QUOTA_LOW = 'relay_token_quota_low',
  RELAY_TOKEN_EXHAUSTED = 'relay_token_exhausted',
  FEEDBACK_STATUS_UPDATED = 'feedback_status_updated',
  FEEDBACK_PUBLIC_REPLY = 'feedback_public_reply',
  FEEDBACK_ASSIGNED = 'feedback_assigned',
  // Security
  ABNORMAL_LOGIN = 'abnormal_login',
  LOGIN_FAILED_MULTIPLE = 'login_failed_multiple',
  PASSWORD_CHANGED = 'password_changed',
  TWO_FACTOR_STATUS_CHANGE = 'two_factor_status_change',
  ACCOUNT_STATUS_CHANGED = 'account_status_changed',
}

export const ALL_NOTIFICATION_EVENTS = Object.values(NotificationEvent);
