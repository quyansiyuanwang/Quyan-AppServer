export enum NotificationEvent {
  // Billing & quota
  BALANCE_LOW = 'balance_low',
  RECHARGE_SUCCESS = 'recharge_success',
  REDEMPTION_SUCCESS = 'redemption_success',
  MONTHLY_PASS_QUOTA_LOW = 'monthly_pass_quota_low',
  MONTHLY_PASS_DAILY_LIMIT = 'monthly_pass_daily_limit',
  RELAY_TOKEN_QUOTA_LOW = 'relay_token_quota_low',
  RELAY_TOKEN_EXHAUSTED = 'relay_token_exhausted',
  TICKET_PENDING_REVIEW = 'ticket_pending_review',
  TICKET_STATUS_UPDATED = 'ticket_status_updated',
  TICKET_PUBLIC_REPLY = 'ticket_public_reply',
  TICKET_ASSIGNED = 'ticket_assigned',
  // Security
  ABNORMAL_LOGIN = 'abnormal_login',
  LOGIN_FAILED_MULTIPLE = 'login_failed_multiple',
  PASSWORD_CHANGED = 'password_changed',
  TWO_FACTOR_STATUS_CHANGE = 'two_factor_status_change',
  ACCOUNT_STATUS_CHANGED = 'account_status_changed',
  // RAM (Resource Access Management)
  RAM_POLICY_ATTACHED = 'ram_policy_attached',
  RAM_POLICY_DETACHED = 'ram_policy_detached',
  RAM_ROLE_BINDING_UPDATED = 'ram_role_binding_updated',
  RAM_USER_CREATED = 'ram_user_created',
  RAM_USER_DELETED = 'ram_user_deleted',
  RAM_ROLE_CREATED = 'ram_role_created',
  RAM_ROLE_DELETED = 'ram_role_deleted',
  RAM_POLICY_CREATED = 'ram_policy_created',
  RAM_POLICY_DELETED = 'ram_policy_deleted',
}

export const ALL_NOTIFICATION_EVENTS = Object.values(NotificationEvent);

export const THRESHOLD_NOTIFICATION_EVENTS = [
  NotificationEvent.BALANCE_LOW,
  NotificationEvent.MONTHLY_PASS_QUOTA_LOW,
  NotificationEvent.MONTHLY_PASS_DAILY_LIMIT,
  NotificationEvent.RELAY_TOKEN_QUOTA_LOW,
] as const;

export const NOTIFICATION_EVENT_I18N_KEYS = {
  [NotificationEvent.BALANCE_LOW]: "notificationEvent.balance_low",
  [NotificationEvent.RECHARGE_SUCCESS]: "notificationEvent.recharge_success",
  [NotificationEvent.REDEMPTION_SUCCESS]: "notificationEvent.redemption_success",
  [NotificationEvent.MONTHLY_PASS_QUOTA_LOW]: "notificationEvent.monthly_pass_quota_low",
  [NotificationEvent.MONTHLY_PASS_DAILY_LIMIT]: "notificationEvent.monthly_pass_daily_limit",
  [NotificationEvent.RELAY_TOKEN_QUOTA_LOW]: "notificationEvent.relay_token_quota_low",
  [NotificationEvent.RELAY_TOKEN_EXHAUSTED]: "notificationEvent.relay_token_exhausted",
  [NotificationEvent.TICKET_PENDING_REVIEW]: "notificationEvent.ticket_pending_review",
  [NotificationEvent.TICKET_STATUS_UPDATED]: "notificationEvent.ticket_status_updated",
  [NotificationEvent.TICKET_PUBLIC_REPLY]: "notificationEvent.ticket_public_reply",
  [NotificationEvent.TICKET_ASSIGNED]: "notificationEvent.ticket_assigned",
  [NotificationEvent.ABNORMAL_LOGIN]: "notificationEvent.abnormal_login",
  [NotificationEvent.LOGIN_FAILED_MULTIPLE]: "notificationEvent.login_failed_multiple",
  [NotificationEvent.PASSWORD_CHANGED]: "notificationEvent.password_changed",
  [NotificationEvent.TWO_FACTOR_STATUS_CHANGE]: "notificationEvent.two_factor_status_change",
  [NotificationEvent.ACCOUNT_STATUS_CHANGED]: "notificationEvent.account_status_changed",
  [NotificationEvent.RAM_POLICY_ATTACHED]: "notificationEvent.ram_policy_attached",
  [NotificationEvent.RAM_POLICY_DETACHED]: "notificationEvent.ram_policy_detached",
  [NotificationEvent.RAM_ROLE_BINDING_UPDATED]: "notificationEvent.ram_role_binding_updated",
  [NotificationEvent.RAM_USER_CREATED]: "notificationEvent.ram_user_created",
  [NotificationEvent.RAM_USER_DELETED]: "notificationEvent.ram_user_deleted",
  [NotificationEvent.RAM_ROLE_CREATED]: "notificationEvent.ram_role_created",
  [NotificationEvent.RAM_ROLE_DELETED]: "notificationEvent.ram_role_deleted",
  [NotificationEvent.RAM_POLICY_CREATED]: "notificationEvent.ram_policy_created",
  [NotificationEvent.RAM_POLICY_DELETED]: "notificationEvent.ram_policy_deleted",
} as const satisfies Record<NotificationEvent, `notificationEvent.${NotificationEvent}`>;

export const NOTIFICATION_EVENT_THRESHOLD_UNIT_I18N_KEYS = {
  [NotificationEvent.BALANCE_LOW]: "notificationEventThresholdUnit.balance_low",
  [NotificationEvent.MONTHLY_PASS_QUOTA_LOW]: "notificationEventThresholdUnit.monthly_pass_quota_low",
  [NotificationEvent.MONTHLY_PASS_DAILY_LIMIT]: "notificationEventThresholdUnit.monthly_pass_daily_limit",
  [NotificationEvent.RELAY_TOKEN_QUOTA_LOW]: "notificationEventThresholdUnit.relay_token_quota_low",
} as const satisfies Partial<Record<NotificationEvent, `notificationEventThresholdUnit.${NotificationEvent}`>>;
