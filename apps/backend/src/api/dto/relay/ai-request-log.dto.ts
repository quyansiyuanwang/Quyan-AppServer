import type { JsonValue } from "@prisma/client/runtime/library";

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
