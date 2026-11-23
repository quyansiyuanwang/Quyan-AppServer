import type {
  RelayConfiguredRequestFormat,
  RelayRequestFormatTransform,
  RelayTokenModelMappingRule,
} from "@quyan/shared";
import type { RelayTokenChannelConfigInputDto, RelayTokenMemberConfigInputDto } from "./relay.dto";

/** Only the edited token is a draft. Referenced tokens are always loaded unchanged. */
export interface RelayTokenModelMappingDraftDto {
  routingMode?: "ordered" | "automatic-pool" | "composite";
  channelId?: string | null;
  channelConfigs?: RelayTokenChannelConfigInputDto[];
  automaticProxyPoolChannelId?: string | null;
  blockedAutomaticProxyPoolChannelIds?: string[] | null;
  memberTokenConfigs?: RelayTokenMemberConfigInputDto[];
  editingTokenId?: string;
  targetUserId?: string;
  allowedModels?: string | null;
  requestFormatTransforms?: RelayRequestFormatTransform[] | null;
  /** Omission preserves the saved policy; null clears it. */
  failoverConfig?: { maxAcceptedChannelMultiplier?: number | null } | null;
  modelMapping?: Record<string, string> | null;
  modelMappingRules?: RelayTokenModelMappingRule[] | null;
}

export interface RelayTokenModelMappingPreviewRequest {
  draft: RelayTokenModelMappingDraftDto;
  requestModel: string;
  requestFormat: RelayConfiguredRequestFormat;
  page?: number;
  pageSize?: number;
}

export interface RelayTokenModelMappingChannelOptionsRequest {
  draft: RelayTokenModelMappingDraftDto;
  search?: string;
  selectedIds?: string[];
  page?: number;
  pageSize?: number;
}

export interface RelayTokenModelMappingPreviewItemDto {
  channelId: string;
  channelName: string;
  tokenPathIds: string[];
  requestedModel: string;
  effectiveModel?: string;
  /** The token whose mapping rule selected this result. */
  ruleSource?: string;
  outcome: "mapped" | "original" | "fallback" | "unavailable";
  reason: string;
}

export interface RelayTokenModelMappingDiagnosticDto {
  ruleIndex: number;
  otherRuleIndex?: number;
  severity: "error" | "warning";
  code: string;
}

export interface RelayTokenModelMappingPreviewDto {
  items: RelayTokenModelMappingPreviewItemDto[];
  total: number;
  page: number;
  pageSize: number;
  diagnostics: RelayTokenModelMappingDiagnosticDto[];
}

export interface RelayTokenModelMappingChannelOptionsDto {
  items: { id: string; name: string }[];
  total: number;
  page: number;
  pageSize: number;
}
