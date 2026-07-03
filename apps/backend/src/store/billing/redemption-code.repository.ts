import { prisma } from "@/config/database";
import type { RedemptionCode, Prisma } from "@prisma/client";
import type { RedemptionCodeStore, RedemptionCodeListItem } from "./redemption-code.store";

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

      const currentAccount = await tx.balanceAccount.findUnique({ where: { userId } });
      const balanceBefore = currentAccount ? Number(currentAccount.balance) : 0;

      const balanceAccount = await tx.balanceAccount.upsert({
        where: { userId },
        create: { userId, balance: redemptionCode.amount, totalRecharged: redemptionCode.amount },
        update: { balance: { increment: redemptionCode.amount }, totalRecharged: { increment: redemptionCode.amount } },
      });

      const balanceAfter = Number(balanceAccount.balance);

      await tx.balanceTransaction.create({
        data: {
          userId,
          type: "redemption",
          amount: Number(redemptionCode.amount),
          balanceBefore,
          balanceAfter,
          relatedId: redemptionCode.id,
          description: `兑换码: ${redemptionCode.code}`,
        },
      });

      return { balance: balanceAfter, amount: Number(redemptionCode.amount) };
    });
  }
}
