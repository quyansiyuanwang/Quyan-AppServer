import type { EmailVerification } from "@prisma/client";

export interface EmailVerificationStore {
  create(email: string, code: string, expiresAt: Date): Promise<EmailVerification>;
  findLatestValid(email: string, code: string): Promise<EmailVerification | null>;
  markUsed(id: string): Promise<EmailVerification>;
}
