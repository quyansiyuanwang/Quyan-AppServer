import type { Prisma, TwoFactorCredential } from "@prisma/client";

export interface TwoFactorCredentialStore {
  findByUserId(userId: string): Promise<TwoFactorCredential | null>;
  upsertByUserId(
    userId: string,
    data: {
      secret: string;
      recoveryCodeHashes: Prisma.InputJsonValue;
    },
  ): Promise<TwoFactorCredential>;
  updateRecoveryCodeHashes(userId: string, recoveryCodeHashes: Prisma.InputJsonValue): Promise<TwoFactorCredential>;
  updateLastUsedAt(userId: string, usedAt: Date): Promise<TwoFactorCredential>;
  deleteByUserId(userId: string): Promise<void>;
}
