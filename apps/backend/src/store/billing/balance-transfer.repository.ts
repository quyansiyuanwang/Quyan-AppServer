import { prisma } from "@/config/database";
import { BadRequestError, ConflictError, NotFoundError } from "@/util/errors";
import type { BalanceTransferStore, CreateGiftCodeParams } from "./balance-transfer.store";

const round4 = (value: number): number => Math.round((value + Number.EPSILON) * 10000) / 10000;

export class BalanceTransferRepository implements BalanceTransferStore {
  private static instance: BalanceTransferRepository;

  static getInstance(): BalanceTransferRepository {
    if (!BalanceTransferRepository.instance) BalanceTransferRepository.instance = new BalanceTransferRepository();
    return BalanceTransferRepository.instance;
  }

  async createGiftCode(params: CreateGiftCodeParams) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.balanceAccount.updateMany({
        where: { userId: params.senderId, balance: { gte: params.totalDebit } },
        data: { balance: { decrement: params.totalDebit } },
      });
      if (updated.count !== 1) throw new BadRequestError("余额不足");

      const account = await tx.balanceAccount.findUniqueOrThrow({ where: { userId: params.senderId } });
      const balanceAfter = Number(account.balance);
      const balanceBefore = round4(balanceAfter + params.totalDebit);
      const giftCode = await tx.balanceGiftCode.create({
        data: {
          code: params.code,
          amount: params.amount,
          feeAmount: params.feeAmount,
          feePercent: params.feePercent,
          cancelFeeRefundPercent: params.cancelFeeRefundPercent,
          totalDebit: params.totalDebit,
          createdBy: params.senderId,
          expiresAt: params.expiresAt,
        },
      });
      await tx.balanceTransaction.create({
        data: {
          userId: params.senderId,
          type: "gift_code_create",
          amount: -params.totalDebit,
          balanceBefore,
          balanceAfter,
          relatedId: giftCode.id,
          description: `用户兑换码创建: ${params.code.slice(-6)}`,
        },
      });
      return { giftCode, balance: balanceAfter };
    });
  }

  async listGiftCodes(senderId: string, skip: number, take: number) {
    const where = { createdBy: senderId };
    const [total, records] = await Promise.all([
      prisma.balanceGiftCode.count({ where }),
      prisma.balanceGiftCode.findMany({
        where,
        orderBy: { createTime: "desc" },
        skip,
        take,
        include: { redeemedByUser: { select: { username: true } } },
      }),
    ]);
    return { total, records };
  }

  async redeemGiftCode(code: string, userId: string) {
    return prisma.$transaction(async (tx) => {
      const giftCode = await tx.balanceGiftCode.findUnique({ where: { code } });
      if (!giftCode) throw new NotFoundError("兑换码不存在");
      if (giftCode.createdBy === userId) throw new BadRequestError("不能兑换自己创建的兑换码");
      if (giftCode.state !== "active") throw new ConflictError("兑换码不可用");
      if (giftCode.expiresAt && giftCode.expiresAt <= new Date()) throw new BadRequestError("兑换码已过期");

      const claimed = await tx.balanceGiftCode.updateMany({
        where: { id: giftCode.id, state: "active", redeemedBy: null, cancelledAt: null },
        data: { state: "redeemed", redeemedBy: userId, redeemedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ConflictError("兑换码已被使用");

      const account = await tx.balanceAccount.upsert({
        where: { userId },
        create: { userId, balance: giftCode.amount, totalRecharged: giftCode.amount },
        update: { balance: { increment: giftCode.amount }, totalRecharged: { increment: giftCode.amount } },
      });
      const balanceAfter = Number(account.balance);
      const amount = Number(giftCode.amount);
      await tx.balanceTransaction.create({
        data: {
          userId,
          type: "gift_code_redeem",
          amount,
          balanceBefore: round4(balanceAfter - amount),
          balanceAfter,
          relatedId: giftCode.id,
          description: `用户兑换码兑换: ${code.slice(-6)}`,
        },
      });
      return { balance: balanceAfter, amount };
    });
  }

  async cancelGiftCode(id: string, senderId: string) {
    return prisma.$transaction(async (tx) => {
      const giftCode = await tx.balanceGiftCode.findUnique({ where: { id } });
      if (!giftCode) throw new NotFoundError("兑换码不存在");
      if (giftCode.createdBy !== senderId) throw new NotFoundError("兑换码不存在");
      if (giftCode.state !== "active") throw new ConflictError("兑换码不可取消");

      const cancelled = await tx.balanceGiftCode.updateMany({
        where: { id, createdBy: senderId, state: "active", redeemedBy: null, cancelledAt: null },
        data: { state: "cancelled", cancelledAt: new Date() },
      });
      if (cancelled.count !== 1) throw new ConflictError("兑换码不可取消");

      const refund = round4(
        Number(giftCode.amount) + (Number(giftCode.feeAmount) * Number(giftCode.cancelFeeRefundPercent)) / 100,
      );
      const account = await tx.balanceAccount.upsert({
        where: { userId: senderId },
        create: { userId: senderId, balance: refund },
        update: { balance: { increment: refund } },
      });
      const balanceAfter = Number(account.balance);
      await tx.balanceGiftCode.update({ where: { id }, data: { refundedAmount: refund } });
      await tx.balanceTransaction.create({
        data: {
          userId: senderId,
          type: "gift_code_cancel",
          amount: refund,
          balanceBefore: round4(balanceAfter - refund),
          balanceAfter,
          relatedId: id,
          description: `用户兑换码取消: ${giftCode.code.slice(-6)}`,
        },
      });
      return { refundedAmount: refund, balance: balanceAfter };
    });
  }

  async createTransfer(params: {
    senderId: string;
    recipientId: string;
    amount: number;
    feeAmount: number;
    feePercent: number;
    totalDebit: number;
    description?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const debited = await tx.balanceAccount.updateMany({
        where: { userId: params.senderId, balance: { gte: params.totalDebit } },
        data: { balance: { decrement: params.totalDebit } },
      });
      if (debited.count !== 1) throw new BadRequestError("余额不足");

      const [senderAccount, recipientAccount] = await Promise.all([
        tx.balanceAccount.findUniqueOrThrow({ where: { userId: params.senderId } }),
        tx.balanceAccount.upsert({
          where: { userId: params.recipientId },
          create: { userId: params.recipientId, balance: params.amount, totalRecharged: params.amount },
          update: { balance: { increment: params.amount }, totalRecharged: { increment: params.amount } },
        }),
      ]);
      const senderBalance = Number(senderAccount.balance);
      const recipientBalance = Number(recipientAccount.balance);
      const transfer = await tx.balanceTransfer.create({ data: params });
      await tx.balanceTransaction.createMany({
        data: [
          {
            userId: params.senderId,
            type: "peer_transfer_out",
            amount: -params.totalDebit,
            balanceBefore: round4(senderBalance + params.totalDebit),
            balanceAfter: senderBalance,
            relatedId: transfer.id,
            description: `转账给用户 ${params.recipientId}`,
          },
          {
            userId: params.recipientId,
            type: "peer_transfer_in",
            amount: params.amount,
            balanceBefore: round4(recipientBalance - params.amount),
            balanceAfter: recipientBalance,
            relatedId: transfer.id,
            description: `来自用户 ${params.senderId} 的转账`,
          },
        ],
      });
      return { transfer, balance: senderBalance };
    });
  }
}
