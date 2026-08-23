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
}
export interface ContentSafetyRuleRequest {
  name: string;
  type: ContentSafetyRuleType;
  pattern: string;
  direction: ContentSafetyDirection | "both";
  action: ContentSafetyAction;
  enabled?: boolean;
  priority?: number;
}
export interface ContentSafetyCsvImportRequest {
  csv: string;
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
