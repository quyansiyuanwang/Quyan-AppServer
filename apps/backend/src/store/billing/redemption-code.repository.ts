import { prisma } from "@/config/database";
import type { RedemptionCode, Prisma } from "@prisma/client";
import type { RedemptionCodeStore, RedemptionCodeListItem } from "./redemption-code.store";
import { applyBalanceAccountMutation } from "./balance-account-mutation";

export type { RedemptionCodeListItem } from "./redemption-code.store";

export class RedemptionCodeRepository implements RedemptionCodeStore {
  private static instance: RedemptionCodeRepository;

  public static getInstance(): RedemptionCodeRepository {
    if (!RedemptionCodeRepository.instance) RedemptionCodeRepository.instance = new RedemptionCodeRepository();

    return RedemptionCodeRepository.instance;
  }

  async create(data: Prisma.RedemptionCodeUncheckedCreateInput): Promise<RedemptionCode> {
    return prisma.redemptionCode.create({ data });
  }

  async countAll(): Promise<number> {
    return prisma.redemptionCode.count();
  }

  async list(skip: number, take: number): Promise<RedemptionCodeListItem[]> {
    return prisma.redemptionCode.findMany({
      orderBy: { createTime: "desc" },
      skip,
      take,
      include: {
        usedByUser: { select: { username: true } },
        createdByUser: { select: { username: true } },
      },
    });
  }

  async deleteById(id: string): Promise<RedemptionCode> {
    return prisma.redemptionCode.delete({ where: { id } });
  }

  async redeem(code: string, userId: string): Promise<{ balance: number; amount: number }> {
    return prisma.$transaction(async (tx) => {
      const redemptionCode = await tx.redemptionCode.findUnique({
        where: { code },
      });

      if (!redemptionCode) throw new Error("REDEMPTION_CODE_NOT_FOUND");
      if (redemptionCode.usedBy) throw new Error("REDEMPTION_CODE_ALREADY_USED");
      if (redemptionCode.expiresAt && redemptionCode.expiresAt < new Date()) throw new Error("REDEMPTION_CODE_EXPIRED");

      await tx.redemptionCode.update({
        where: { id: redemptionCode.id },
        data: { usedBy: userId, usedAt: new Date() },
      });

      const mutation = await applyBalanceAccountMutation(tx, {
        userId,
        balanceDelta: redemptionCode.amount,
        totalRechargedDelta: redemptionCode.amount,
        createIfMissing: true,
      });
      if (!mutation) throw new Error("Balance account mutation unexpectedly failed");

      await tx.balanceTransaction.create({
        data: {
          userId,
          type: "redemption",
          amount: Number(redemptionCode.amount),
          balanceBefore: mutation.balanceBefore,
          balanceAfter: mutation.balanceAfter,
          relatedId: redemptionCode.id,
          description: `兑换码: ${redemptionCode.code}`,
        },
      });

      return { balance: Number(mutation.balanceAfter), amount: Number(redemptionCode.amount) };
    });
  }
}
