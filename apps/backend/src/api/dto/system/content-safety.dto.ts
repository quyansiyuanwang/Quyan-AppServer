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
  targetUserId?: string;
}
export interface ContentSafetyCsvImportResponse {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}
export interface ContentSafetyConfigDto {
  requestEnabled: boolean;
  requestAction: ContentSafetyAction;
  requestAiEnabled: boolean;
  responseEnabled: boolean;
  responseAction: ContentSafetyAction;
  responseAiEnabled: boolean;
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
    requestAiEnabled: boolean | null;
    responseEnabled: boolean | null;
    responseAction: ContentSafetyAction | null;
    responseAiEnabled: boolean | null;
  };
}
export interface ContentSafetyConfigRequest {
  requestEnabled: boolean;
  requestAction: ContentSafetyAction;
  requestAiEnabled: boolean;
  responseEnabled: boolean;
  responseAction: ContentSafetyAction;
  responseAiEnabled: boolean;
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
  requestAiEnabled: boolean | null;
  responseEnabled: boolean | null;
  responseAction: ContentSafetyAction | null;
  responseAiEnabled: boolean | null;
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
  requestId?: string | null;
  direction: string;
  action: string;
  source: string;
  ruleId?: string | null;
  rule?: { name: string; type: string } | null;
  channelId?: string | null;
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
}
