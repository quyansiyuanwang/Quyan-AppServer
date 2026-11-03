export interface RelayProbeDailyScheduleDto {
  id?: string;
  enabled: boolean;
  timezone: "Asia/Shanghai";
  minuteOfDay: number;
  version: number;
  nextRunAt: Date;
}

export interface SaveRelayProbeDailyScheduleRequest {
  enabled: boolean;
  /** Minutes since midnight in Asia/Shanghai. Defaults to 03:00. */
  minuteOfDay: number;
  /** Zero creates a schedule; subsequent edits must match the saved version. */
  expectedVersion: number;
}

/** A deliberately allowlisted projection: no workflow, credentials or raw upstream response. */
export interface RelayProbeRoundTargetReportDto {
  id: string;
  channelId: string;
  memberChannelId?: string;
  channelName: string;
  memberChannelName?: string;
  runId?: string;
  state: string;
  upstreamCurrency?: string;
  localCurrency?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  balanceDelta?: number;
  localBalanceBefore?: number;
  localBalanceAfter?: number;
  localBalanceDelta?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  baseLocalCost?: number;
  measuredMultiplier?: number;
  currentMultiplier?: number;
  suggestedMultiplier?: number;
  multiplierChange?: number;
  multiplierChangePercent?: number;
  previousSuggestedMultiplier?: number;
  suggestionChange?: number;
  suggestionChangePercent?: number;
  calibrationStatus?: string;
  errorStage?: string;
  errorCode?: string;
}

export interface RelayProbeRoundDto {
  id: string;
  scheduledFor: Date;
  startedAt?: Date;
  finishedAt?: Date;
  state: string;
  targetCount: number;
  notificationState?: string;
  errorStage?: string;
  errorCode?: string;
}

export interface RelayProbeRoundPageDto {
  items: RelayProbeRoundDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RelayProbeRoundTargetPageDto {
  round: RelayProbeRoundDto;
  items: RelayProbeRoundTargetReportDto[];
  total: number;
  page: number;
  pageSize: number;
}
