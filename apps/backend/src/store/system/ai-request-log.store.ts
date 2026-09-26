import type { AIRequestLog, Prisma } from "@prisma/client";

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
}

export type AIRequestLogListItem = Omit<AIRequestLog, "requestBody" | "responseBody">;

export interface AIRequestLogStore {
  create(input: Prisma.AIRequestLogUncheckedCreateInput): Promise<AIRequestLog | null>;
  query(query: AIRequestLogQuery): Promise<{ items: AIRequestLogListItem[]; total: number }>;
  findById(id: string): Promise<AIRequestLog | null>;
}
