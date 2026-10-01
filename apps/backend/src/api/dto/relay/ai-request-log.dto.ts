import type { JsonValue } from "@prisma/client/runtime/library";
import type {
  AIRequestLogOutcome,
  AIRequestLogStage,
  AIRequestLogAuthState,
  AIRequestLogOmissionReason,
} from "@/constant/ai-request-log";

export interface AIRequestLogListItemDto {
  id: string;
  createTime: Date;
  requestId: string;
  userId: string | null;
  username: string | null;
  relayTokenId: string | null;
  relayTokenName: string | null;
  model: string | null;
  requestFormat: string | null;
  path: string;
  method: string;
  statusCode: number;
  ipAddress: string;
  userAgent: string | null;
  durationMs: number;
  requestSizeBytes: number | null;
  responseSizeBytes: number | null;
  requestTruncated: boolean;
  responseTruncated: boolean;
  isStreaming?: boolean | null;
  authenticationState?: AIRequestLogAuthState | null;
  outcome?: AIRequestLogOutcome | null;
  failureStage?: AIRequestLogStage | null;
  errorCode?: string | null;
  errorSummary?: string | null;
  bodyOmissionReason?: AIRequestLogOmissionReason | null;
  attemptsTruncated?: boolean | null;
}
export interface AIRequestLogListResponse {
  items: AIRequestLogListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}
export interface AIRequestLogDetailDto extends AIRequestLogListItemDto {
  requestBody: JsonValue;
  responseBody: JsonValue;
}
export type AIRequestLogContentSide = "request" | "response";
export type AIRequestLogContentView = "parsed" | "raw";
export interface AIRequestLogMetadataDto extends AIRequestLogListItemDto {
  availableSides: AIRequestLogContentSide[];
}
export interface AIRequestLogContentItemDto {
  expandable?: boolean;
  locator: string;
  path: string;
  section: string;
  label: string;
  text: string;
  offset: number;
  totalBytes: number;
  nextCursor: string | null;
}
export interface AIRequestLogContentPageDto {
  items: AIRequestLogContentItemDto[];
  nextCursor: string | null;
  hasMore: boolean;
  totalItems: number;
  storedBytes: number;
  truncated: boolean;
  omissionReason: AIRequestLogOmissionReason | null;
}
export interface AIRequestLogSearchHitDto {
  side: AIRequestLogContentSide | "attempts";
  locator: string;
  path: string;
  section: string;
  excerpt: string;
  matchText: string;
  matchStart: number;
  matchEnd: number;
  offset: number;
}
export interface AIRequestLogSearchPageDto {
  items: AIRequestLogSearchHitDto[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  truncated: boolean;
  omissionReason: AIRequestLogOmissionReason | null;
}
export interface AIRequestLogAttemptDto {
  sequence: number;
  stage: AIRequestLogStage;
  success: boolean;
  statusCode: number | null;
  durationMs: number | null;
  errorExcerpt: string | null;
  errorTruncated: boolean;
}
export interface AIRequestLogAttemptsPageDto {
  items: AIRequestLogAttemptDto[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  truncated: boolean;
}
