import type { Prisma, RedemptionCode } from "@prisma/client";

export type RedemptionCodeListItem = Prisma.RedemptionCodeGetPayload<{
  include: {
    usedByUser: { select: { username: true } };
    createdByUser: { select: { username: true } };
  };
}>;

export interface RedemptionCodeStore {
  create(data: Prisma.RedemptionCodeUncheckedCreateInput): Promise<RedemptionCode>;
  countAll(): Promise<number>;
  list(skip: number, take: number): Promise<RedemptionCodeListItem[]>;
  deleteById(id: string): Promise<RedemptionCode>;
  redeem(code: string, userId: string): Promise<{ balance: number; amount: number }>;
}
