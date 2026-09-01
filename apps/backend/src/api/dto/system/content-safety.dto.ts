import type {
  ContentSafetyAction,
  ContentSafetyDirection,
  ContentSafetyRuleType,
  RelayRequestFormat,
} from "@appserver/shared";

export interface ContentSafetyRuleDto {
  id: string;
  name: string;
  type: ContentSafetyRuleType;
  pattern: string;
  direction: ContentSafetyDirection | "both";
  action: ContentSafetyAction;
  enabled: boolean;
  priority: number;
  source: string;
  ownerUserId?: string | null;
  userEnabled?: boolean;
  canEdit?: boolean;
}
export interface ContentSafetyRuleRequest {
  name: string;
  type: ContentSafetyRuleType;
  pattern: string;
  direction: ContentSafetyDirection | "both";
  action: ContentSafetyAction;
  enabled?: boolean;
  priority?: number;
  targetUserId?: string;
}
export interface ContentSafetyCsvImportRequest {
  csv: string;
  mode?: "preview" | "apply";
  overwrite?: boolean;
  targetUserId?: string;
}
export interface ContentSafetyCsvImportResponse {
  imported: number;
  updated?: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  operations?: Array<{
    row: number;
    operation: "create" | "update" | "skip";
    id?: string;
    name: string;
    pattern: string;
    oldValue?: Partial<ContentSafetyRuleDto>;
    newValue?: Partial<ContentSafetyRuleDto>;
  }>;
}
export interface ContentSafetyBatchUpdateRequest {
  ids: string[];
  changes: {
    enabled?: boolean;
    action?: ContentSafetyAction;
    direction?: ContentSafetyDirection | "both";
    priority?: number;
  };
  targetUserId?: string;
}
export interface ContentSafetyBatchUpdateResponse {
  updated: number;
}
export interface ContentSafetyExportRequest {
  format?: "json" | "csv";
  targetUserId?: string;
}
export interface ContentSafetyExportDto {
  format: "json" | "csv";
  filename: string;
  content: string;
}
export interface ContentSafetyConfigDto {
  requestEnabled: boolean;
  requestAction: ContentSafetyAction;
  requestMaxAction: ContentSafetyAction;
  requestAiEnabled: boolean;
  requestAiAction: ContentSafetyAction;
  responseEnabled: boolean;
  responseAction: ContentSafetyAction;
  responseMaxAction: ContentSafetyAction;
  responseAiEnabled: boolean;
  responseAiAction: ContentSafetyAction;
  aiUpstreamUrl: string;
  aiApiKeyConfigured: boolean;
  aiModel: string;
  aiRequestFormat: RelayRequestFormat;
  aiTimeoutMs: number;
  aiInputPricePerMillion: number;
  aiOutputPricePerMillion: number;
  aiMaxTextLength: number;
  userConfig?: {
    requestEnabled: boolean | null;
    requestAction: ContentSafetyAction | null;
    requestMaxAction: ContentSafetyAction | null;
    requestAiEnabled: boolean | null;
    requestAiAction: ContentSafetyAction | null;
    responseEnabled: boolean | null;
    responseAction: ContentSafetyAction | null;
    responseMaxAction: ContentSafetyAction | null;
    responseAiEnabled: boolean | null;
    responseAiAction: ContentSafetyAction | null;
  };
}
export interface ContentSafetyConfigRequest {
  requestEnabled: boolean;
  requestAction: ContentSafetyAction;
  requestMaxAction: ContentSafetyAction;
  requestAiEnabled: boolean;
  requestAiAction?: ContentSafetyAction;
  responseEnabled: boolean;
  responseAction: ContentSafetyAction;
  responseMaxAction: ContentSafetyAction;
  responseAiEnabled: boolean;
  responseAiAction?: ContentSafetyAction;
  aiUpstreamUrl: string;
  aiApiKey?: string;
  clearAiApiKey?: boolean;
  aiModel: string;
  aiRequestFormat: RelayRequestFormat;
  aiTimeoutMs: number;
  aiInputPricePerMillion: number;
  aiOutputPricePerMillion: number;
  aiMaxTextLength: number;
}

export interface ContentSafetyUserConfigRequest {
  requestEnabled: boolean | null;
  requestAction: ContentSafetyAction | null;
  requestMaxAction: ContentSafetyAction | null;
  requestAiEnabled: boolean | null;
  requestAiAction: ContentSafetyAction | null;
  responseEnabled: boolean | null;
  responseAction: ContentSafetyAction | null;
  responseMaxAction: ContentSafetyAction | null;
  responseAiEnabled: boolean | null;
  responseAiAction: ContentSafetyAction | null;
  targetUserId?: string;
}

export interface ContentSafetyRuleOverrideRequest {
  ruleId: string;
  enabled: boolean;
  targetUserId?: string;
}
export interface ContentSafetyIncidentDto {
  id: string;
  createTime: string;
  userId: string;
  relayTokenId?: string | null;
  relayTokenName?: string | null;
  requestId?: string | null;
  direction: string;
  action: string;
  source: string;
  ruleId?: string | null;
  rule?: { name: string; type: string; pattern?: string } | null;
  channelId?: string | null;
  channelName?: string | null;
  statusCode?: number | null;
  model?: string | null;
  auditModel?: string | null;
  auditInputTokens: number;
  auditOutputTokens: number;
  auditTotalTokens: number;
  auditCost: number;
  auditDurationMs: number;
  replaced: boolean;
  blocked: boolean;
  matchText?: string | null;
  /** One combined excerpt; the UI highlights the matching portion temporarily. */
  matchContext?: string | null;
}

export type ContentSafetyIncidentSortBy = "createTime" | "requestId" | "action" | "source" | "statusCode";
export type ContentSafetyIncidentSortOrder = "asc" | "desc";
export type ContentSafetyIncidentStatus = "allow" | "replaced" | "blocked";

export interface ContentSafetyIncidentQuery {
  page?: number;
  pageSize?: number;
  userId?: string;
  startTime?: string;
  endTime?: string;
  direction?: ContentSafetyDirection;
  source?: "rule" | "ai";
  processingStatus?: ContentSafetyIncidentStatus;
  requestId?: string;
  relayTokenName?: string;
  channelName?: string;
  sortBy?: ContentSafetyIncidentSortBy;
  sortOrder?: ContentSafetyIncidentSortOrder;
}
