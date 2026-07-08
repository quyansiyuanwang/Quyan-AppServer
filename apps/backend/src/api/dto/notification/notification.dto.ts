// ─── Request DTOs ─────────────────────────────────────────────────────────────

export interface UpdateNotificationPreferenceDto {
  /** Notification email address (null to clear) */
  notificationEmail?: string | null;
  /** List of subscribed event types */
  subscribedEvents?: string[];
  /** Per-event threshold values (e.g. { balance_low: 10, monthly_pass_quota_low: 20 }) */
  thresholds?: Record<string, number>;
  /** Cooldown period in minutes between same-event notifications */
  cooldownMinutes?: number;
}

export interface CreateNotificationWebhookDto {
  /** Display name */
  name: string;
  /** Webhook URL */
  url: string;
  /** Payload format: generic | discord | slack | feishu | wechat_work */
  format: string;
  /** Optional HMAC-SHA256 signing secret */
  secret?: string | null;
  /** Whether this webhook is active */
  enabled?: boolean;
}

export interface UpdateNotificationWebhookDto {
  name?: string;
  url?: string;
  format?: string;
  secret?: string | null;
  enabled?: boolean;
}

export interface GetNotificationLogsQueryDto {
  page?: number;
  pageSize?: number;
}

// ─── Response DTOs ────────────────────────────────────────────────────────────

export interface NotificationPreferenceDto {
  id: string;
  notificationEmail: string | null;
  subscribedEvents: string[];
  thresholds: Record<string, number>;
  cooldownMinutes: number;
  createTime: string;
  updateTime: string;
}

export interface NotificationWebhookDto {
  id: string;
  name: string;
  url: string;
  format: string;
  /** Secret is masked in responses */
  hasSecret: boolean;
  enabled: boolean;
  createTime: string;
  updateTime: string;
}

export interface NotificationLogDto {
  id: string;
  eventType: string;
  title: string;
  content: string;
  channel: string;
  webhookId: string | null;
  deliveryStatus: string;
  errorMessage: string | null;
  createTime: string;
}

export interface NotificationInboxItemDto {
  id: string;
  eventType: string;
  title: string;
  content: string;
  isRead: boolean;
  readTime: string | null;
  /** How this item was marked read: "manual" (user clicked) or "pixel" (confirmed from an email open) */
  readSource: string | null;
  /** Whether the email tracking pixel for this item has been fetched at least once */
  pixelOpened: boolean;
  pixelOpenedTime: string | null;
  metadata?: Record<string, unknown> | null;
  createTime: string;
  updateTime: string;
}

export interface NotificationInboxListDto {
  items: NotificationInboxItemDto[];
  total: number;
  unreadCount: number;
  /** Count of unread items whose email tracking pixel has been opened but not yet confirmed as read */
  pixelOpenedUnreadCount: number;
  page: number;
  pageSize: number;
}

export interface NotificationLogListDto {
  logs: NotificationLogDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NotificationEventInfoDto {
  value: string;
  labelI18nKey: string;
  hasThreshold: boolean;
  thresholdUnitI18nKey?: string;
}

export interface MarkNotificationInboxReadDto {
  ids?: string[];
  markAll?: boolean;
}
