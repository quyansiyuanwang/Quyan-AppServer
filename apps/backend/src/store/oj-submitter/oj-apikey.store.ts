import type { OJAPIKey, Prisma, RelayChannel } from "@prisma/client";

export type OJAPIKeyWithChannel = OJAPIKey & { channel: RelayChannel | null };

export interface OJAPIKeyStore {
  create(data: Prisma.OJAPIKeyUncheckedCreateInput): Promise<OJAPIKeyWithChannel>;
  findActiveByKey(key: string): Promise<OJAPIKeyWithChannel | null>;
  listActiveByUserId(userId: string): Promise<OJAPIKeyWithChannel[]>;
  findActiveByIdAndUserId(id: string, userId: string): Promise<OJAPIKeyWithChannel | null>;
  softDeleteById(id: string): Promise<OJAPIKey>;
  updateById(id: string, data: Prisma.OJAPIKeyUncheckedUpdateInput): Promise<OJAPIKeyWithChannel>;
  incrementUsageById(id: string, totalTokens: number): Promise<OJAPIKey>;
  countActiveByUserId(userId: string): Promise<number>;
  countActiveUnexpiredByUserId(userId: string, now?: Date): Promise<number>;
  aggregateUsageByUserId(userId: string): Promise<{ requestCount: number; totalTokens: number }>;
}
