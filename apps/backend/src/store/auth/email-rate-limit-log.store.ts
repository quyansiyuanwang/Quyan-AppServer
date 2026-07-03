import type { EmailRateLimitLog } from "@prisma/client";

export interface EmailRateLimitLogStore {
  create(ipAddress: string, email: string, action: string, requestTime: Date): Promise<EmailRateLimitLog>;
  countRequests(ipAddress: string, email: string | null, action: string, windowStart: Date): Promise<number>;
  findOldestRequest(
    ipAddress: string,
    email: string | null,
    action: string,
  ): Promise<Pick<EmailRateLimitLog, "requestTime"> | null>;
  deleteOlderThan(cutoffDate: Date): Promise<number>;
}
