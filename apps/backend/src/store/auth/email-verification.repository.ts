import { prisma } from "@/config/database";
import type { EmailVerification } from "@prisma/client";
import type { EmailVerificationStore } from "./email-verification.store";

export class EmailVerificationRepository implements EmailVerificationStore {
  private static instance: EmailVerificationRepository;

  public static getInstance(): EmailVerificationRepository {
    if (!EmailVerificationRepository.instance) EmailVerificationRepository.instance = new EmailVerificationRepository();

    return EmailVerificationRepository.instance;
  }

  async create(email: string, code: string, expiresAt: Date): Promise<EmailVerification> {
    return prisma.emailVerification.create({
      data: {
        email,
        code,
        expiresAt,
      },
    });
  }

  async findLatestValid(email: string, code: string): Promise<EmailVerification | null> {
    return prisma.emailVerification.findFirst({
      where: {
        email,
        code,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createTime: "desc" },
    });
  }

  async markUsed(id: string): Promise<EmailVerification> {
    return prisma.emailVerification.update({
      where: { id },
      data: { used: true },
    });
  }
}
