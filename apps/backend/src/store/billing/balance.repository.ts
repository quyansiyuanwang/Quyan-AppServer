import { prisma } from "@/config/database";
import { Decimal } from "@prisma/client/runtime/library";
import type { BalanceAccount, BalanceTransaction, Prisma } from "@prisma/client";
import type { BalanceStore, RechargeParams } from "./balance.store";
import { NotificationService } from "@/services/notification/notification.service";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import { NotificationEvent } from "@/constant/notification-event";
import { RECORD_STATUS } from "@/constant/status";

export type { RechargeParams } from "./balance.store";

export class BalanceRepository implements BalanceStore {
  private static instance: BalanceRepository;

  public static getInstance(): BalanceRepository {
    if (!BalanceRepository.instance) BalanceRepository.instance = new BalanceRepository();

    return BalanceRepository.instance;
  }

  async findAccountByUserId(userId: string): Promise<BalanceAccount | null> {
    return prisma.balanceAccount.findUnique({ where: { userId } });
  }

  async findAccountsByUserIds(userIds: string[]): Promise<BalanceAccount[]> {
    if (userIds.length === 0) return [];

    return prisma.balanceAccount.findMany({
      where: { userId: { in: userIds } },
    });
  }

  async recharge(params: RechargeParams): Promise<BalanceAccount> {
    const { userId, amount, description, countAsStatistics } = params;

    const result = await prisma.$transaction(async (tx) => {
      let account = await tx.balanceAccount.findUnique({ where: { userId } });

      if (!account) account = await tx.balanceAccount.create({ data: { userId, balance: 0 } });

      const balanceBefore = Number(account.balance);
      const updateData: Prisma.BalanceAccountUpdateInput = {};

      if (countAsStatistics) {
        if (amount > 0) updateData.totalRecharged = { increment: amount };
        else updateData.totalUsed = { increment: Math.abs(amount) };

        const currentTotalRecharged = Number(account.totalRecharged);
        const currentTotalUsed = Number(account.totalUsed);
        const newTotalRecharged = amount > 0 ? currentTotalRecharged + amount : currentTotalRecharged;
        const newTotalUsed = amount < 0 ? currentTotalUsed + Math.abs(amount) : currentTotalUsed;
        const newBalance = newTotalRecharged - newTotalUsed;

        updateData.balance = new Decimal(newBalance);
      } else {
        const newBalance = Math.floor((balanceBefore + amount) * 10000) / 10000;
        updateData.balance = new Decimal(newBalance);
      }

      const updatedAccount = await tx.balanceAccount.update({
        where: { userId },
        data: updateData,
      });
      const balanceAfter = Number(updatedAccount.balance);

      await tx.balanceTransaction.create({
        data: {
          userId,
          type: "recharge",
          amount,
          balanceBefore,
          balanceAfter,
          description: description || "管理员充值",
        },
      });

      return updatedAccount;
    });

    // Fire-and-forget notifications
    if (amount < 0) this.dispatchBalanceLowNotification(userId).catch(() => {});
    else if (amount > 0)
      this.dispatchRechargeSuccessNotification(userId, amount, Number(result.balance)).catch(() => {});

    return result;
  }

  private async dispatchBalanceLowNotification(userId: string): Promise<void> {
    try {
      const prefRepo = NotificationPreferenceRepository.getInstance();
      const pref = await prefRepo.findByUserId(userId);
      if (!pref) return;

      const subscribedEvents = (pref.subscribedEvents as string[]) ?? [];
      if (!subscribedEvents.includes(NotificationEvent.BALANCE_LOW)) return;

      const thresholds = (pref.thresholds as Record<string, number>) ?? {};
      const balanceThreshold = thresholds[NotificationEvent.BALANCE_LOW] ?? 10;

      const account = await this.findAccountByUserId(userId);
      if (!account) return;

      const balanceAfter = Number(account.balance);
      if (balanceAfter < balanceThreshold)
        NotificationService.getInstance().dispatch(userId, NotificationEvent.BALANCE_LOW, {
          currentBalance: balanceAfter.toFixed(4),
          threshold: balanceThreshold,
        });
    } catch {
      // non-fatal
    }
  }

  private async dispatchRechargeSuccessNotification(
    userId: string,
    amount: number,
    balanceAfter: number,
  ): Promise<void> {
    try {
      const prefRepo = NotificationPreferenceRepository.getInstance();
      const pref = await prefRepo.findByUserId(userId);
      if (!pref) return;

      const subscribedEvents = (pref.subscribedEvents as string[]) ?? [];
      if (!subscribedEvents.includes(NotificationEvent.RECHARGE_SUCCESS)) return;

      NotificationService.getInstance().dispatch(userId, NotificationEvent.RECHARGE_SUCCESS, {
        amount: amount.toFixed(4),
        balanceAfter: balanceAfter.toFixed(4),
      });
    } catch {
      // non-fatal
    }
  }

  async findTransactions(
    where: Prisma.BalanceTransactionWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: BalanceTransaction[] }> {
    const [total, records] = await Promise.all([
      prisma.balanceTransaction.count({ where }),
      prisma.balanceTransaction.findMany({
        where,
        orderBy: { createTime: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, records };
  }

  async sumCacheTokensByUserId(userId: string): Promise<{
    inputTokens: number;
    cacheReadTokens: number;
  }> {
    const aggregate = await prisma.balanceTransaction.aggregate({
      where: {
        userId,
        status: RECORD_STATUS.ACTIVE,
        inputTokens: { not: null },
      },
      _sum: {
        inputTokens: true,
        cacheReadTokens: true,
      },
    });

    return {
      inputTokens: Number(aggregate._sum.inputTokens || 0),
      cacheReadTokens: Number(aggregate._sum.cacheReadTokens || 0),
    };
  }
}
