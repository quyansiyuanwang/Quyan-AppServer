import { prisma } from "@/config/database";
import { Prisma, type OJAPIKey } from "@prisma/client";
import type { OJAPIKeyStore, OJAPIKeyWithChannel } from "./oj-apikey.store";
import { RECORD_STATUS } from "@/constant/status";
import { ConflictError } from "@/util/errors";
import { findUniquePlaintextCredential, keyCredentialWhere, plaintextCredentialValues } from "../plaintext-credential";

export async function assertOjApiKeyAvailable(tx: Prisma.TransactionClient, key: string) {
  const values = plaintextCredentialValues(key, "ojApiKey");
  if (!values.length || (await tx.oJAPIKey.findFirst({ where: keyCredentialWhere(values), select: { id: true } })))
    throw new ConflictError("OJ API key unavailable", undefined, { messageKey: "errors.conflict" });
}

export class OJAPIKeyRepository implements OJAPIKeyStore {
  private static instance: OJAPIKeyRepository;

  public static getInstance(): OJAPIKeyRepository {
    if (!OJAPIKeyRepository.instance) OJAPIKeyRepository.instance = new OJAPIKeyRepository();

    return OJAPIKeyRepository.instance;
  }

  async create(data: Prisma.OJAPIKeyUncheckedCreateInput): Promise<OJAPIKeyWithChannel> {
    return prisma.$transaction(
      async (tx) => {
        await assertOjApiKeyAvailable(tx, data.key);
        return tx.oJAPIKey.create({ data, include: { channel: true } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async findActiveByKey(key: string): Promise<OJAPIKeyWithChannel | null> {
    const values = plaintextCredentialValues(key, "ojApiKey");
    if (!values.length) return null;
    const rows = await prisma.oJAPIKey.findMany({
      where: keyCredentialWhere(values),
      include: { channel: true },
    });
    const match = findUniquePlaintextCredential(rows, values, (row) => [row.key, row.legacyKey]);
    return match?.status === RECORD_STATUS.ACTIVE ? match : null;
  }

  async listActiveByUserId(userId: string): Promise<OJAPIKeyWithChannel[]> {
    return prisma.oJAPIKey.findMany({
      where: { userId, status: RECORD_STATUS.ACTIVE },
      orderBy: { createTime: "desc" },
      include: { channel: true },
    }) as Promise<OJAPIKeyWithChannel[]>;
  }

  async findActiveByIdAndUserId(id: string, userId: string): Promise<OJAPIKeyWithChannel | null> {
    return prisma.oJAPIKey.findFirst({
      where: { id, userId, status: RECORD_STATUS.ACTIVE },
      include: { channel: true },
    }) as Promise<OJAPIKeyWithChannel | null>;
  }

  async softDeleteById(id: string): Promise<OJAPIKey> {
    return prisma.oJAPIKey.update({
      where: { id },
      data: { status: RECORD_STATUS.DELETED },
    });
  }

  async updateById(id: string, data: Prisma.OJAPIKeyUncheckedUpdateInput): Promise<OJAPIKeyWithChannel> {
    return prisma.oJAPIKey.update({
      where: { id },
      data,
      include: { channel: true },
    }) as Promise<OJAPIKeyWithChannel>;
  }

  async incrementUsageById(id: string, totalTokens: number): Promise<OJAPIKey> {
    return prisma.oJAPIKey.update({
      where: { id },
      data: {
        requestCount: { increment: 1 },
        totalTokens: { increment: totalTokens },
        lastUsedAt: new Date(),
      },
    });
  }

  async countActiveByUserId(userId: string): Promise<number> {
    return prisma.oJAPIKey.count({
      where: { userId, status: RECORD_STATUS.ACTIVE },
    });
  }

  async countActiveUnexpiredByUserId(userId: string, now: Date = new Date()): Promise<number> {
    return prisma.oJAPIKey.count({
      where: {
        userId,
        status: RECORD_STATUS.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
  }

  async aggregateUsageByUserId(userId: string): Promise<{ requestCount: number; totalTokens: number }> {
    const [requestAgg, tokenAgg] = await Promise.all([
      prisma.oJAPIKey.aggregate({
        where: { userId, status: RECORD_STATUS.ACTIVE },
        _sum: { requestCount: true },
      }),
      prisma.oJAPIKey.aggregate({
        where: { userId, status: RECORD_STATUS.ACTIVE },
        _sum: { totalTokens: true },
      }),
    ]);

    return {
      requestCount: requestAgg._sum.requestCount || 0,
      totalTokens: tokenAgg._sum.totalTokens || 0,
    };
  }
}
