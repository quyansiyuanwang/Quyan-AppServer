import { prisma } from "@/config/database";
import type { Prisma, PrismaClient, TwoFactorCredential } from "@prisma/client";
import type { TwoFactorCredentialStore } from "./two-factor.store";
import { InternalServerError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("TwoFactorCredentialRepository", LogCategory.SYSTEM);
const MISSING_DELEGATE_MESSAGE =
  "Prisma 客户端缺少 twoFactorCredential 模型委托，请执行 `pnpm run db:generate` 并重启后端进程。";
type TwoFactorCredentialDelegate = PrismaClient["twoFactorCredential"];

function isTwoFactorCredentialDelegate(candidate: unknown): candidate is TwoFactorCredentialDelegate {
  return (
    candidate != null &&
    typeof candidate === "object" &&
    typeof (candidate as { findUnique?: unknown }).findUnique === "function"
  );
}

export class TwoFactorCredentialRepository implements TwoFactorCredentialStore {
  private static instance: TwoFactorCredentialRepository;
  private delegate: TwoFactorCredentialDelegate | null = null;
  private hasLoggedMissingDelegate = false;

  public static getInstance(): TwoFactorCredentialRepository {
    if (!TwoFactorCredentialRepository.instance)
      TwoFactorCredentialRepository.instance = new TwoFactorCredentialRepository();

    return TwoFactorCredentialRepository.instance;
  }

  private getDelegate(): TwoFactorCredentialDelegate {
    if (this.delegate) return this.delegate;

    const candidate: unknown = prisma.twoFactorCredential;
    if (!isTwoFactorCredentialDelegate(candidate)) {
      if (!this.hasLoggedMissingDelegate) {
        this.hasLoggedMissingDelegate = true;
        logger.error(MISSING_DELEGATE_MESSAGE);
      }

      throw new InternalServerError("二次验证存储不可用，请联系管理员。");
    }

    this.delegate = candidate;
    return this.delegate;
  }

  async findByUserId(userId: string): Promise<TwoFactorCredential | null> {
    const delegate = this.getDelegate();

    return delegate.findUnique({
      where: { userId },
    });
  }

  async upsertByUserId(
    userId: string,
    data: {
      secret: string;
      recoveryCodeHashes: Prisma.InputJsonValue;
    },
  ): Promise<TwoFactorCredential> {
    const delegate = this.getDelegate();
    logger.debug("Upserting 2FA credential", { userId });

    return delegate.upsert({
      where: { userId },
      create: {
        userId,
        secret: data.secret,
        recoveryCodeHashes: data.recoveryCodeHashes,
      },
      update: {
        secret: data.secret,
        recoveryCodeHashes: data.recoveryCodeHashes,
      },
    });
  }

  async updateRecoveryCodeHashes(
    userId: string,
    recoveryCodeHashes: Prisma.InputJsonValue,
  ): Promise<TwoFactorCredential> {
    const delegate = this.getDelegate();
    logger.debug("Updating 2FA recovery code hashes", { userId });

    return delegate.update({
      where: { userId },
      data: {
        recoveryCodeHashes,
      },
    });
  }

  async updateLastUsedAt(userId: string, usedAt: Date): Promise<TwoFactorCredential> {
    const delegate = this.getDelegate();
    logger.debug("Updating 2FA last used timestamp", { userId });

    return delegate.update({
      where: { userId },
      data: {
        lastUsedAt: usedAt,
      },
    });
  }

  async deleteByUserId(userId: string): Promise<void> {
    const delegate = this.getDelegate();
    logger.debug("Deleting 2FA credential", { userId });

    await delegate.deleteMany({
      where: { userId },
    });
  }
}
