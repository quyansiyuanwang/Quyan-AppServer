export type ErrorResolutionStatus = "open" | "acknowledged" | "resolved" | "ignored";

export interface ClientErrorReportRequest {
  errorType: string;
  message: string;
  route?: string;
  severity?: "error" | "fatal" | "warning";
  requestId?: string;
  httpMethod?: string;
  httpStatus?: number;
  clientVersion?: string;
  stack?: string;
  context?: Record<string, unknown>;
}

export interface ClientErrorReportBatchRequest {
  reports: ClientErrorReportRequest[];
}

export interface ErrorGroupDTO {
  id: string;
  fingerprint: string;
  source: string;
  errorType: string;
  message: string;
  route: string | null;
  severity: string;
  resolutionStatus: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrenceCount: number;
  affectedUserCount: number;
}

export interface ErrorOccurrenceDTO {
  id: string;
  userId: string | null;
  requestId: string | null;
  source: string;
  route: string | null;
  httpMethod: string | null;
  httpStatus: number | null;
  clientVersion: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  stack: string | null;
  context: unknown;
  createTime: Date;
}

export interface ErrorGroupListResponse {
  items: ErrorGroupDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ErrorOccurrenceListResponse {
  items: ErrorOccurrenceDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateErrorGroupStatusRequest {
  resolutionStatus: ErrorResolutionStatus;
}
