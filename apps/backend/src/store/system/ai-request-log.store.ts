import type { AIRequestLog, Prisma } from "@prisma/client";
import type { AIRequestLogOutcome, AIRequestLogStage } from "@/constant/ai-request-log";
import type { AIRequestLogContentSide } from "@/api/dto/relay/ai-request-log.dto";
export interface AIRequestLogQuery {
  page: number;
  pageSize: number;
  user?: string;
  relayToken?: string;
  model?: string;
  requestFormat?: string;
  statusCode?: number;
  requestId?: string;
  keyword?: string;
  truncated?: boolean;
  startDate?: Date;
  endDate?: Date;
  outcome?: AIRequestLogOutcome;
  isStreaming?: boolean;
  failureStage?: AIRequestLogStage;
  ipAddress?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  bodyOmissionReason?: string;
}
export type AIRequestLogListItem = Omit<AIRequestLog, "requestBody" | "responseBody" | "attempts">;
export type AIRequestLogMetadata = AIRequestLogListItem & { hasRequestBody: boolean; hasResponseBody: boolean };
export type AIRequestLogPayload = Pick<
  AIRequestLog,
  "requestBody" | "responseBody" | "requestTruncated" | "responseTruncated" | "bodyOmissionReason"
>;
export interface AIRequestLogStore {
  create(input: Prisma.AIRequestLogUncheckedCreateInput): Promise<AIRequestLog | null>;
  updateByRequestId(requestId: string, input: Prisma.AIRequestLogUpdateManyMutationInput): Promise<void>;
  query(query: AIRequestLogQuery): Promise<{ items: AIRequestLogListItem[]; total: number }>;
  findById(id: string): Promise<AIRequestLog | null>;
  findMetadata(id: string): Promise<AIRequestLogMetadata | null>;
  findPayload(id: string, side: AIRequestLogContentSide): Promise<AIRequestLogPayload | null>;
  findAttempts(id: string): Promise<Pick<AIRequestLog, "attempts" | "attemptsTruncated"> | null>;
}
