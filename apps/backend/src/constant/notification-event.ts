import {
  NotificationEvent,
  ALL_NOTIFICATION_EVENTS,
  THRESHOLD_NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_I18N_KEYS,
  NOTIFICATION_EVENT_THRESHOLD_UNIT_I18N_KEYS,
} from "@appserver/shared";
export {
  NotificationEvent,
  ALL_NOTIFICATION_EVENTS,
  THRESHOLD_NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_I18N_KEYS,
  NOTIFICATION_EVENT_THRESHOLD_UNIT_I18N_KEYS,
};

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  [NotificationEvent.BALANCE_LOW]: "余额不足",
  [NotificationEvent.RECHARGE_SUCCESS]: "充值成功",
  [NotificationEvent.REDEMPTION_SUCCESS]: "兑换码兑换成功",
  [NotificationEvent.MONTHLY_PASS_QUOTA_LOW]: "月卡额度不足",
  [NotificationEvent.MONTHLY_PASS_DAILY_LIMIT]: "月卡即将达到日限额",
  [NotificationEvent.RELAY_TOKEN_QUOTA_LOW]: "中转令牌即将限额",
  [NotificationEvent.RELAY_TOKEN_EXHAUSTED]: "中转令牌额度耗尽",
  [NotificationEvent.FEEDBACK_PENDING_REVIEW]: "新工单待分诊",
  [NotificationEvent.FEEDBACK_STATUS_UPDATED]: "工单状态更新",
  [NotificationEvent.FEEDBACK_PUBLIC_REPLY]: "工单收到回复",
  [NotificationEvent.FEEDBACK_ASSIGNED]: "工单已分配",
  [NotificationEvent.ABNORMAL_LOGIN]: "账户异常登录",
  [NotificationEvent.LOGIN_FAILED_MULTIPLE]: "多次登录失败",
  [NotificationEvent.PASSWORD_CHANGED]: "密码已修改",
  [NotificationEvent.TWO_FACTOR_STATUS_CHANGE]: "2FA 状态变更",
  [NotificationEvent.ACCOUNT_STATUS_CHANGED]: "账户状态变更",
  [NotificationEvent.RAM_POLICY_ATTACHED]: "权限策略已绑定",
  [NotificationEvent.RAM_POLICY_DETACHED]: "权限策略已解绑",
  [NotificationEvent.RAM_ROLE_BINDING_UPDATED]: "RAM角色绑定关系变更",
  [NotificationEvent.RAM_USER_CREATED]: "RAM用户已创建",
  [NotificationEvent.RAM_USER_DELETED]: "RAM用户已删除",
  [NotificationEvent.RAM_ROLE_CREATED]: "RAM角色已创建",
  [NotificationEvent.RAM_ROLE_DELETED]: "RAM角色已删除",
  [NotificationEvent.RAM_POLICY_CREATED]: "权限策略已创建",
  [NotificationEvent.RAM_POLICY_DELETED]: "权限策略已删除",
};

export const THRESHOLD_EVENTS = THRESHOLD_NOTIFICATION_EVENTS;
