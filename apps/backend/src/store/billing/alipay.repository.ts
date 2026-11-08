import { Prisma, type PaymentOrder, type PaymentRefund } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/config/database";
import { BadRequestError, ConflictError, NotFoundError } from "@/util/errors";
import { applyBalanceAccountMutation, lockBalanceAccount } from "./balance-account-mutation";
import { ALIPAY_POLICY, refundCredit } from "@/services/billing/alipay-policy";

const include = { profile: true, refunds: { orderBy: { createTime: "desc" as const }, take: 20 } } as const;
export type AlipayOrderRecord = Prisma.PaymentOrderGetPayload<{ include: typeof include }>;
const invalid = () =>
  new BadRequestError("Invalid payment operation", undefined, { messageKey: "payment.invalidOperation" });

export class AlipayRepository {
  private static instance: AlipayRepository;
  static getInstance() {
    return (this.instance ??= new AlipayRepository());
  }

  profile(id: string) {
    return prisma.alipayProfile.findUnique({ where: { id } });
  }
  createProfile(data: Prisma.AlipayProfileCreateInput) {
    return prisma.alipayProfile.create({ data });
  }
  get(id: string) {
    return prisma.paymentOrder.findUnique({ where: { id }, include });
  }
  byTradeNo(outTradeNo: string) {
    return prisma.paymentOrder.findUnique({ where: { outTradeNo }, include });
  }
  byRequest(userId: string, requestId: string) {
    return prisma.paymentOrder.findUnique({ where: { userId_requestId: { userId, requestId } }, include });
  }
  async create(data: Prisma.PaymentOrderUncheckedCreateInput) {
    try {
      return await prisma.paymentOrder.create({ data, include });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.byRequest(data.userId, data.requestId);
        if (existing && existing.amount.equals(String(data.amount))) return existing;
        throw new ConflictError("Payment request already exists", undefined, { messageKey: "payment.requestConflict" });
      }
      throw error;
    }
  }
  async list(page: number, pageSize: number, userId?: string) {
    const where = { status: 1, ...(userId ? { userId } : {}) };
    const [records, total] = await prisma.$transaction([
      prisma.paymentOrder.findMany({
        where,
        include,
        orderBy: [{ createTime: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.paymentOrder.count({ where }),
    ]);
    return { records, total, page, pageSize };
  }
  async credit(id: string, tradeNo: string, providerState: string) {
    return prisma.$transaction(
      async (tx) => {
        await this.lockOrder(tx, id);
        const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id } });
        if (order.tradeNo && order.tradeNo !== tradeNo) throw invalid();
        if (order.paidAt) {
          if (providerState === "TRADE_FINISHED")
            await tx.paymentOrder.update({ where: { id }, data: { providerState } });
          return false;
        }
        const mutation = await applyBalanceAccountMutation(tx, {
          userId: order.userId,
          balanceDelta: order.creditAmount,
          totalRechargedDelta: order.creditAmount,
          createIfMissing: true,
          requireActive: true,
        });
        if (!mutation || mutation.balanceAfter.gt(ALIPAY_POLICY.maxBalance)) throw invalid();
        await tx.balanceTransaction.create({
          data: {
            userId: order.userId,
            type: "alipay_recharge",
            amount: order.creditAmount,
            balanceBefore: mutation.balanceBefore,
            balanceAfter: mutation.balanceAfter,
            relatedId: id,
            description: "Alipay recharge " + order.outTradeNo,
          },
        });
        await tx.paymentOrder.update({
          where: { id },
          data: { state: "paid", tradeNo, providerState, paidAt: new Date() },
        });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async close(id: string) {
    // Never overwrite an already credited order with a late close/refund notification.
    return prisma.paymentOrder.updateMany({
      where: { id, paidAt: null },
      data: { state: "closed", providerState: "TRADE_CLOSED" },
    });
  }
  private async lockOrder(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM payment_orders WHERE id=${id} FOR UPDATE`);
  }
  async reserveRefund(
    id: string,
    outRequestNo: string,
    amount: Decimal,
    reason: string,
    createdBy: string,
    authorize: () => Promise<void>,
  ) {
    return prisma.$transaction(
      async (tx) => {
        await authorize();
        await this.lockOrder(tx, id);
        const order = await tx.paymentOrder.findUnique({ where: { id } });
        if (!order || !order.paidAt || !order.tradeNo || order.providerState === "TRADE_FINISHED") throw invalid();
        const existing = await tx.paymentRefund.findUnique({ where: { outRequestNo } });
        if (existing) {
          if (existing.orderId !== id || !existing.amount.equals(amount) || existing.reason !== reason) throw invalid();
          return { refund: existing, created: false };
        }
        if (await tx.paymentRefund.count({ where: { orderId: id, state: "processing" } })) throw invalid();
        if (amount.lte(0) || order.refundedAmount.plus(amount).gt(order.amount)) throw invalid();
        const creditAmount = refundCredit(order.amount, order.creditAmount, order.refundedAmount, amount);
        await lockBalanceAccount(tx, order.userId);
        const reserved = await tx.balanceReservation.aggregate({
          where: { userId: order.userId, state: "reserved", status: 1 },
          _sum: { amount: true },
        });
        const mutation = await applyBalanceAccountMutation(tx, {
          userId: order.userId,
          balanceDelta: creditAmount.negated(),
          minimumBalance: reserved._sum.amount ?? 0,
          requireActive: true,
        });
        if (!mutation)
          throw new BadRequestError("Insufficient available balance for refund", undefined, {
            messageKey: "payment.insufficientBalance",
          });
        const refund = await tx.paymentRefund.create({
          data: { orderId: id, outRequestNo, amount, creditAmount, reason, createdBy },
        });
        await tx.balanceTransaction.create({
          data: {
            userId: order.userId,
            type: "alipay_refund_hold",
            amount: creditAmount.negated(),
            balanceBefore: mutation.balanceBefore,
            balanceAfter: mutation.balanceAfter,
            relatedId: refund.id,
            description: "Alipay refund pending " + outRequestNo,
          },
        });
        await tx.paymentOrder.update({ where: { id }, data: { state: "refunding" } });
        await authorize();
        return { refund, created: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async finishRefund(id: string, success: boolean, failureCode?: string) {
    const initial = await prisma.paymentRefund.findUnique({ where: { id } });
    if (!initial) throw new NotFoundError("Refund not found", undefined, { messageKey: "payment.notFound" });
    return prisma.$transaction(
      async (tx) => {
        await this.lockOrder(tx, initial.orderId);
        const refund = await tx.paymentRefund.findUniqueOrThrow({ where: { id } });
        if (refund.state !== "processing") return refund;
        const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id: refund.orderId } });
        const mutation = await applyBalanceAccountMutation(tx, {
          userId: order.userId,
          balanceDelta: success ? 0 : refund.creditAmount,
          totalRechargedDelta: success ? refund.creditAmount.negated() : undefined,
        });
        if (!mutation) throw invalid();
        if (!success)
          await tx.balanceTransaction.create({
            data: {
              userId: order.userId,
              type: "alipay_refund_reversal",
              amount: refund.creditAmount,
              balanceBefore: mutation.balanceBefore,
              balanceAfter: mutation.balanceAfter,
              relatedId: id,
              description: "Alipay refund released " + refund.outRequestNo,
            },
          });
        const refundedAmount = order.refundedAmount.plus(success ? refund.amount : 0);
        await tx.paymentOrder.update({
          where: { id: order.id },
          data: {
            refundedAmount,
            state: refundedAmount.equals(order.amount)
              ? "refunded"
              : refundedAmount.gt(0)
                ? "partially_refunded"
                : "paid",
          },
        });
        return tx.paymentRefund.update({
          where: { id },
          data: { state: success ? "succeeded" : "failed", failureCode, completedAt: new Date() },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  refund(id: string) {
    return prisma.paymentRefund.findUnique({ where: { id }, include: { order: { include } } });
  }
  refundByRequest(outRequestNo: string) {
    return prisma.paymentRefund.findUnique({ where: { outRequestNo } });
  }
  async listRefunds(orderId: string, page: number, pageSize: number) {
    const where = { orderId };
    const [records, total] = await prisma.$transaction([
      prisma.paymentRefund.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createTime: "desc" }, { id: "desc" }],
      }),
      prisma.paymentRefund.count({ where }),
    ]);
    return { records, total, page, pageSize };
  }
  dueOrders() {
    return prisma.paymentOrder.findMany({
      where: { state: "pending", nextQueryAt: { lte: new Date() } },
      include,
      take: ALIPAY_POLICY.batchSize,
      orderBy: { nextQueryAt: "asc" },
    });
  }
  dueRefunds() {
    return prisma.paymentRefund.findMany({
      where: { state: "processing", nextQueryAt: { lte: new Date() } },
      take: ALIPAY_POLICY.batchSize,
      orderBy: { nextQueryAt: "asc" },
    });
  }
  deferOrder(id: string) {
    return prisma.paymentOrder.update({
      where: { id },
      data: { queryAttempts: { increment: 1 }, nextQueryAt: new Date(Date.now() + ALIPAY_POLICY.queryIntervalMs) },
    });
  }
  deferRefund(id: string) {
    return prisma.paymentRefund.update({
      where: { id },
      data: { queryAttempts: { increment: 1 }, nextQueryAt: new Date(Date.now() + ALIPAY_POLICY.queryIntervalMs) },
    });
  }
}

export type { PaymentOrder, PaymentRefund };
