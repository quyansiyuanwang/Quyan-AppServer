import { ALL_NOTIFICATION_EVENTS, NotificationEvent, NOTIFICATION_EVENT_LABELS } from "@/constant/notification-event";
import type { RelayProbeRoundTargetReportDto } from "@/api/dto/relay/relay-probe-round.dto";

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
  [NotificationEvent.RELAY_PROBE_ROUND_COMPLETED]: NotificationTemplateInput & {
    roundId: string;
    scheduledFor: string;
    targets: RelayProbeRoundTargetReportDto[];
    errorStage?: string;
    errorCode?: string;
    detailsUrl: string;
  };
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

const probeRoundTemplate: NotificationTemplate<
  NotificationEventInputMap[NotificationEvent.RELAY_PROBE_ROUND_COMPLETED]
> = {
  build(input, timestamp) {
    const succeeded = input.targets.filter((target) => target.state === "succeeded").length;
    return {
      event: NotificationEvent.RELAY_PROBE_ROUND_COMPLETED,
      subject: "每日余额探针汇总",
      summary: `${input.scheduledFor}：${input.targets.length} 个目标，${succeeded} 个成功。倍率建议需手动确认，未自动改价。`,
      severity: !input.errorCode && succeeded === input.targets.length ? "success" : "warning",
      blocks: compactBlocks([
        ...(input.errorCode
          ? [
              notificationBlocks.fields(
                [field("错误阶段", input.errorStage), field("错误原因", input.errorCode)],
                "轮次未能正常发现或执行目标",
              ),
            ]
          : []),
        ...input.targets.map((target) =>
          notificationBlocks.fields(
            [
              field("状态", target.state),
              field("上游币种", target.upstreamCurrency),
              field("余额（前）", target.balanceBefore),
              field("余额（后）", target.balanceAfter),
              field("余额变化", target.balanceDelta),
              field("本地币种", target.localCurrency),
              field("本地余额（前）", target.localBalanceBefore),
              field("本地余额（后）", target.localBalanceAfter),
              field("本地余额变化", target.localBalanceDelta),
              field(
                "输入 / 输出 Token",
                target.inputTokens === undefined ? undefined : `${target.inputTokens} / ${target.outputTokens ?? 0}`,
              ),
              field("缓存读取 Token", target.cacheReadTokens),
              field("缓存写入 Token", target.cacheCreationTokens),
              field("基础成本", target.baseLocalCost),
              field("测量时倍率", target.measuredMultiplier),
              field("汇总时倍率", target.currentMultiplier),
              field("建议倍率", target.suggestedMultiplier),
              field("建议与测量值差额", target.multiplierChange),
              field("建议与测量值变化率（%）", target.multiplierChangePercent),
              field("上次有效建议", target.previousSuggestedMultiplier),
              field("相对上次建议变化", target.suggestionChange),
              field("相对上次建议变化率（%）", target.suggestionChangePercent),
              field("校准状态", target.calibrationStatus),
              field("错误阶段", target.errorStage),
              field("错误原因", target.errorCode),
            ],
            target.memberChannelName ? `${target.channelName} / ${target.memberChannelName}` : target.channelName,
          ),
        ),
        notificationBlocks.actions([{ label: "查看轮次详情并手动确认建议", url: input.detailsUrl }]),
      ]),
      timestamp,
      metadata: businessMetadata(input),
    };
  },
};

export class NotificationTemplateRegistry {
  private static readonly templates: Record<NotificationEvent, NotificationTemplate> = {
    ...Object.fromEntries(ALL_NOTIFICATION_EVENTS.map((event) => [event, genericTemplate])),
    [NotificationEvent.BALANCE_LOW]: balanceLowTemplate,
    [NotificationEvent.RECHARGE_SUCCESS]: rechargeTemplate(NotificationEvent.RECHARGE_SUCCESS),
    [NotificationEvent.REDEMPTION_SUCCESS]: rechargeTemplate(NotificationEvent.REDEMPTION_SUCCESS),
    [NotificationEvent.DEVELOPER_MONITOR_DOWN]: monitorTemplate,
    [NotificationEvent.DEVELOPER_MONITOR_RECOVERED]: monitorTemplate,
    [NotificationEvent.RELAY_PROBE_ROUND_COMPLETED]: probeRoundTemplate,
  } as Record<NotificationEvent, NotificationTemplate>;

  static build<E extends NotificationEvent>(event: E, input: NotificationInputFor<E>): NotificationDocument {
    const timestamp = new Date().toISOString();
    const template = this.templates[event] ?? genericTemplate;
    return template.build({ ...input, event }, timestamp);
  }
}
