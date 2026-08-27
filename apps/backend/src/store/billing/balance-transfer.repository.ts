import { prisma } from "@/config/database";
import { BadRequestError, ConflictError, NotFoundError } from "@/util/errors";
import type {
  BalanceTransferDisplayRecord,
  BalanceTransferStore,
  CreateGiftCodeParams,
} from "./balance-transfer.store";
import { applyBalanceAccountMutation, lockBalanceAccounts } from "./balance-account-mutation";

const round4 = (value: number): number => Math.round((value + Number.EPSILON) * 10000) / 10000;

export class BalanceTransferRepository implements BalanceTransferStore {
  private static instance: BalanceTransferRepository;

  static getInstance(): BalanceTransferRepository {
    if (!BalanceTransferRepository.instance) BalanceTransferRepository.instance = new BalanceTransferRepository();
    return BalanceTransferRepository.instance;
  }

  async createGiftCode(params: CreateGiftCodeParams) {
    return prisma.$transaction(async (tx) => {
      const mutation = await applyBalanceAccountMutation(tx, {
        userId: params.senderId,
        balanceDelta: -params.totalDebit,
        minimumBalance: 0,
      });
      if (!mutation) throw new BadRequestError("余额不足");
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
          balanceBefore: mutation.balanceBefore,
          balanceAfter: mutation.balanceAfter,
          relatedId: giftCode.id,
          description: `用户兑换码创建: ${params.code.slice(-6)}`,
        },
      });
      return { giftCode, balance: Number(mutation.balanceAfter) };
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

      const mutation = await applyBalanceAccountMutation(tx, {
        userId,
        balanceDelta: giftCode.amount,
        totalRechargedDelta: giftCode.amount,
        createIfMissing: true,
      });
      if (!mutation) throw new ConflictError("余额账户更新失败");
      const amount = Number(giftCode.amount);
      await tx.balanceTransaction.create({
        data: {
          userId,
          type: "gift_code_redeem",
          amount,
          balanceBefore: mutation.balanceBefore,
          balanceAfter: mutation.balanceAfter,
          relatedId: giftCode.id,
          description: `用户兑换码兑换: ${code.slice(-6)}`,
        },
      });
      return { balance: Number(mutation.balanceAfter), amount };
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
      const mutation = await applyBalanceAccountMutation(tx, {
        userId: senderId,
        balanceDelta: refund,
        createIfMissing: true,
      });
      if (!mutation) throw new ConflictError("余额账户更新失败");
      await tx.balanceGiftCode.update({ where: { id }, data: { refundedAmount: refund } });
      await tx.balanceTransaction.create({
        data: {
          userId: senderId,
          type: "gift_code_cancel",
          amount: refund,
          balanceBefore: mutation.balanceBefore,
          balanceAfter: mutation.balanceAfter,
          relatedId: id,
          description: `用户兑换码取消: ${giftCode.code.slice(-6)}`,
        },
      });
      return { refundedAmount: refund, balance: Number(mutation.balanceAfter) };
    });
  }

  async findTransferDisplayRecords(ids: string[]): Promise<BalanceTransferDisplayRecord[]> {
    if (ids.length === 0) return [];

    const records = await prisma.balanceTransfer.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        description: true,
        sender: { select: { username: true } },
        recipient: { select: { username: true } },
      },
    });
    return records.map((record) => ({
      id: record.id,
      senderUsername: record.sender.username,
      recipientUsername: record.recipient.username,
      description: record.description,
    }));
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
      await lockBalanceAccounts(tx, [
        { userId: params.senderId },
        { userId: params.recipientId, createIfMissing: true },
      ]);
      const senderMutation = await applyBalanceAccountMutation(tx, {
        userId: params.senderId,
        balanceDelta: -params.totalDebit,
        minimumBalance: 0,
      });
      if (!senderMutation) throw new BadRequestError("余额不足");
      const recipientMutation = await applyBalanceAccountMutation(tx, {
        userId: params.recipientId,
        balanceDelta: params.amount,
        totalRechargedDelta: params.amount,
        createIfMissing: true,
      });
      if (!recipientMutation) throw new ConflictError("余额账户更新失败");

      const [sender, recipient] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: params.senderId }, select: { username: true } }),
        tx.user.findUniqueOrThrow({ where: { id: params.recipientId }, select: { username: true } }),
      ]);
      const transfer = await tx.balanceTransfer.create({ data: params });
      await tx.balanceTransaction.createMany({
        data: [
          {
            userId: params.senderId,
            type: "peer_transfer_out",
            amount: -params.totalDebit,
            balanceBefore: senderMutation.balanceBefore,
            balanceAfter: senderMutation.balanceAfter,
            relatedId: transfer.id,
            description: `转账给用户 ${recipient.username}${params.description ? `：${params.description}` : ""}`,
          },
          {
            userId: params.recipientId,
            type: "peer_transfer_in",
            amount: params.amount,
            balanceBefore: recipientMutation.balanceBefore,
            balanceAfter: recipientMutation.balanceAfter,
            relatedId: transfer.id,
            description: `来自用户 ${sender.username} 的转账${params.description ? `：${params.description}` : ""}`,
          },
        ],
      });
      return { transfer, balance: Number(senderMutation.balanceAfter) };
    });
  }
}
