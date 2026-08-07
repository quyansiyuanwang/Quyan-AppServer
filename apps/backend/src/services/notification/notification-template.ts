import { ALL_NOTIFICATION_EVENTS, NotificationEvent, NOTIFICATION_EVENT_LABELS } from "@/constant/notification-event";

export type NotificationSeverity = "info" | "success" | "warning" | "error";

export type NotificationBlock =
  | { type: "text"; text: string }
  | { type: "status"; label: string; value: string; tone?: NotificationSeverity }
  | { type: "fields"; title?: string; items: NotificationField[] }
  | { type: "actions"; items: NotificationAction[] };

export interface NotificationField {
  label: string;
  value: string;
  emphasis?: boolean;
}

export interface NotificationAction {
  label: string;
  url: string;
}

export interface NotificationDocument {
  event: NotificationEvent;
  subject: string;
  summary: string;
  severity: NotificationSeverity;
  blocks: NotificationBlock[];
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export type NotificationTemplateInput = Record<string, unknown>;

export interface DeveloperMonitorNotificationInput extends NotificationTemplateInput {
  monitorName: string;
  targetUrl: string;
  method: string;
  previousStatus: string;
  currentStatus: string;
  statusCode: number | null;
  latencyMs: number;
  checkedAt: string;
  errorMessage?: string | null;
}

export interface NotificationEventInputMap {
  [NotificationEvent.DEVELOPER_MONITOR_DOWN]: DeveloperMonitorNotificationInput;
  [NotificationEvent.DEVELOPER_MONITOR_RECOVERED]: DeveloperMonitorNotificationInput;
  [NotificationEvent.BALANCE_LOW]: NotificationTemplateInput & {
    currentBalance: string | number;
    threshold: string | number;
  };
  [NotificationEvent.RECHARGE_SUCCESS]: NotificationTemplateInput & {
    amount: string | number;
    balanceAfter: string | number;
  };
  [NotificationEvent.REDEMPTION_SUCCESS]: NotificationTemplateInput & {
    amount: string | number;
    balanceAfter: string | number;
  };
  [NotificationEvent.LOGIN_FAILED_MULTIPLE]: NotificationTemplateInput & {
    failCount: string | number;
    windowMinutes: string | number;
  };
  [NotificationEvent.TWO_FACTOR_STATUS_CHANGE]: NotificationTemplateInput & { enabled: boolean };
  [event: string]: NotificationTemplateInput;
}

export type NotificationInputFor<E extends NotificationEvent> = E extends keyof NotificationEventInputMap
  ? NotificationEventInputMap[E]
  : NotificationTemplateInput;

export interface NotificationTemplate<TInput extends NotificationTemplateInput = NotificationTemplateInput> {
  build(input: TInput, timestamp: string): NotificationDocument;
}

export const notificationBlocks = {
  text(text: string): NotificationBlock {
    return { type: "text", text };
  },
  status(label: string, value: string, tone?: NotificationSeverity): NotificationBlock {
    return { type: "status", label, value, tone };
  },
  fields(items: Array<NotificationField | null | undefined>, title?: string): NotificationBlock | null {
    const compactItems = items.filter((item): item is NotificationField => Boolean(item?.value));
    return compactItems.length ? { type: "fields", title, items: compactItems } : null;
  },
  actions(items: NotificationAction[]): NotificationBlock | null {
    return items.length ? { type: "actions", items } : null;
  },
};

const field = (label: string, value: unknown, emphasis = false): NotificationField | null => {
  if (value === undefined || value === null || value === "") return null;
  return { label, value: String(value), emphasis };
};

const compactBlocks = (blocks: Array<NotificationBlock | null>): NotificationBlock[] =>
  blocks.filter((block): block is NotificationBlock => block !== null);

const businessMetadata = (input: NotificationTemplateInput): Record<string, unknown> =>
  Object.fromEntries(Object.entries(input).filter(([key]) => !["event", "subject", "summary"].includes(key)));

const severityForEvent = (event: NotificationEvent): NotificationSeverity => {
  if (event === NotificationEvent.DEVELOPER_MONITOR_RECOVERED || event === NotificationEvent.RECHARGE_SUCCESS)
    return "success";
  if (
    event === NotificationEvent.DEVELOPER_MONITOR_DOWN ||
    event === NotificationEvent.ABNORMAL_LOGIN ||
    event === NotificationEvent.LOGIN_FAILED_MULTIPLE
  )
    return "error";
  if (
    event === NotificationEvent.BALANCE_LOW ||
    event === NotificationEvent.MONTHLY_PASS_QUOTA_LOW ||
    event === NotificationEvent.MONTHLY_PASS_DAILY_LIMIT ||
    event === NotificationEvent.RELAY_TOKEN_QUOTA_LOW ||
    event === NotificationEvent.RELAY_TOKEN_EXHAUSTED
  )
    return "warning";
  return "info";
};

const genericTemplate: NotificationTemplate = {
  build(input, timestamp) {
    const event = input.event as NotificationEvent;
    const subject = (input.subject as string | undefined) ?? NOTIFICATION_EVENT_LABELS[event] ?? event;
    const summary = (input.summary as string | undefined) ?? subject;
    const entries = Object.entries(input).filter(([key]) => !["event", "subject", "summary"].includes(key));
    return {
      event,
      subject,
      summary,
      severity: severityForEvent(event),
      blocks: compactBlocks([notificationBlocks.fields(entries.map(([key, value]) => field(key, value)))]),
      timestamp,
      metadata: businessMetadata(input),
    };
  },
};

const monitorTemplate: NotificationTemplate<DeveloperMonitorNotificationInput> = {
  build(input, timestamp) {
    const recovered = input.currentStatus === "up";
    const state = recovered ? "正常" : "异常";
    return {
      event: recovered ? NotificationEvent.DEVELOPER_MONITOR_RECOVERED : NotificationEvent.DEVELOPER_MONITOR_DOWN,
      subject: `${recovered ? "监控恢复" : "监控异常"}：${input.monitorName}`,
      summary: recovered ? "服务已恢复" : "服务不可用，请及时检查。",
      severity: recovered ? "success" : "error",
      blocks: compactBlocks([
        notificationBlocks.status("监控结果", state, recovered ? "success" : "error"),
        notificationBlocks.fields([
          field("目标", input.targetUrl),
          field("请求方法", input.method),
          field("HTTP 状态", input.statusCode === null ? null : `HTTP ${input.statusCode}`),
          field("延迟", `${input.latencyMs} ms`),
          field("检查时间", input.checkedAt),
          field("错误摘要", input.errorMessage),
        ]),
      ]),
      timestamp,
      metadata: businessMetadata(input),
    };
  },
};

const balanceLowTemplate: NotificationTemplate<NotificationEventInputMap[NotificationEvent.BALANCE_LOW]> = {
  build(input, timestamp) {
    return {
      event: NotificationEvent.BALANCE_LOW,
      subject: "余额不足提醒",
      summary: "当前余额已低于设定阈值，请及时充值。",
      severity: "warning",
      blocks: compactBlocks([
        notificationBlocks.status("账户状态", "余额不足", "warning"),
        notificationBlocks.fields([field("当前余额", input.currentBalance, true), field("提醒阈值", input.threshold)]),
      ]),
      timestamp,
      metadata: businessMetadata(input),
    };
  },
};

const rechargeTemplate = (event: NotificationEvent.RECHARGE_SUCCESS | NotificationEvent.REDEMPTION_SUCCESS) =>
  ({
    build(
      input: NotificationEventInputMap[NotificationEvent.RECHARGE_SUCCESS],
      timestamp: string,
    ): NotificationDocument {
      const redeemed = event === NotificationEvent.REDEMPTION_SUCCESS;
      return {
        event,
        subject: redeemed ? "兑换码兑换成功" : "充值成功",
        summary: redeemed ? "兑换金额已到账。" : "充值金额已到账。",
        severity: "success",
        blocks: compactBlocks([
          notificationBlocks.status("处理结果", "成功", "success"),
          notificationBlocks.fields([
            field(redeemed ? "兑换金额" : "充值金额", input.amount, true),
            field("当前余额", input.balanceAfter),
          ]),
        ]),
        timestamp,
        metadata: businessMetadata(input),
      };
    },
  }) satisfies NotificationTemplate<NotificationEventInputMap[NotificationEvent.RECHARGE_SUCCESS]>;

export class NotificationTemplateRegistry {
  private static readonly templates: Record<NotificationEvent, NotificationTemplate> = {
    ...Object.fromEntries(ALL_NOTIFICATION_EVENTS.map((event) => [event, genericTemplate])),
    [NotificationEvent.BALANCE_LOW]: balanceLowTemplate,
    [NotificationEvent.RECHARGE_SUCCESS]: rechargeTemplate(NotificationEvent.RECHARGE_SUCCESS),
    [NotificationEvent.REDEMPTION_SUCCESS]: rechargeTemplate(NotificationEvent.REDEMPTION_SUCCESS),
    [NotificationEvent.DEVELOPER_MONITOR_DOWN]: monitorTemplate,
    [NotificationEvent.DEVELOPER_MONITOR_RECOVERED]: monitorTemplate,
  } as Record<NotificationEvent, NotificationTemplate>;

  static build<E extends NotificationEvent>(event: E, input: NotificationInputFor<E>): NotificationDocument {
    const timestamp = new Date().toISOString();
    const template = this.templates[event] ?? genericTemplate;
    return template.build({ ...input, event }, timestamp);
  }
}
