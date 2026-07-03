import { prisma } from "@/config/database";
import type { EmailRateLimitLog } from "@prisma/client";
import type { EmailRateLimitLogStore } from "./email-rate-limit-log.store";
import { RECORD_STATUS } from "@/constant/status";

export class EmailRateLimitLogRepository implements EmailRateLimitLogStore {
  private static instance: EmailRateLimitLogRepository;

  public static getInstance(): EmailRateLimitLogRepository {
    if (!EmailRateLimitLogRepository.instance) EmailRateLimitLogRepository.instance = new EmailRateLimitLogRepository();

    return EmailRateLimitLogRepository.instance;
  }

  async create(ipAddress: string, email: string, action: string, requestTime: Date): Promise<EmailRateLimitLog> {
    return prisma.emailRateLimitLog.create({
      data: {
        ipAddress,
        email,
        action,
        requestTime,
      },
    });
  }

  async countRequests(ipAddress: string, email: string | null, action: string, windowStart: Date): Promise<number> {
    const where: { ipAddress: string; action: string; requestTime: { gte: Date }; status: number; email?: string } = {
      ipAddress,
      action,
      requestTime: { gte: windowStart },
      status: RECORD_STATUS.ACTIVE,
    };

    if (email !== null) where.email = email;

    return prisma.emailRateLimitLog.count({ where });
  }

  async findOldestRequest(
    ipAddress: string,
    email: string | null,
    action: string,
  ): Promise<Pick<EmailRateLimitLog, "requestTime"> | null> {
    const where: { ipAddress: string; action: string; status: number; email?: string } = {
      ipAddress,
      action,
      status: RECORD_STATUS.ACTIVE,
    };

    if (email !== null) where.email = email;

    return prisma.emailRateLimitLog.findFirst({
      where,
      orderBy: { requestTime: "asc" },
      select: { requestTime: true },
    });
  }

  async deleteOlderThan(cutoffDate: Date): Promise<number> {
    const result = await prisma.emailRateLimitLog.deleteMany({
      where: {
        requestTime: { lt: cutoffDate },
      },
    });

    return result.count;
  }
}
