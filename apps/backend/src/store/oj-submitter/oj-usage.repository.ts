import { prisma } from "@/config/database";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import type { OJChargeAndRecordUsageParams, OJUsageStatsResult, OJUsageStore } from "./oj-usage.store";
import { RECORD_STATUS } from "@/constant/status";
import { applyBalanceAccountMutation } from "@/store/billing/balance-account-mutation";

export type { OJChargeAndRecordUsageParams } from "./oj-usage.store";

export class OJUsageRepository implements OJUsageStore {
  private static instance: OJUsageRepository;

  public static getInstance(): OJUsageRepository {
    if (!OJUsageRepository.instance) OJUsageRepository.instance = new OJUsageRepository();

    return OJUsageRepository.instance;
  }

  async chargeAndRecordUsage(params: OJChargeAndRecordUsageParams): Promise<boolean> {
    const {
      userId,
      keyId,
      model,
      question,
      answer,
      inputTokens,
      outputTokens,
      totalTokens,
      cacheCreationTokens,
      cacheReadTokens,
      cost,
      ipAddress,
      responseTime,
      inputRate,
      outputRate,
      multiplier,
      cacheCreationMultiplier,
      cacheReadMultiplier,
    } = params;

    return prisma.$transaction(async (tx) => {
      const mutation = await applyBalanceAccountMutation(tx, {
        userId,
        balanceDelta: new Decimal(-cost),
        totalUsedDelta: new Decimal(cost),
        minimumBalance: 0,
      });
      if (!mutation) return false;

      await tx.balanceTransaction.create({
        data: {
          userId,
          type: "api_usage",
          amount: new Decimal(-cost),
          balanceBefore: mutation.balanceBefore,
          balanceAfter: mutation.balanceAfter,
          relatedId: keyId,
          description: "OJSubmitter AI问答",
          model,
          tokens: totalTokens,
          inputTokens,
          outputTokens,
          cacheCreationTokens,
          cacheReadTokens,
          inputRate: new Decimal(inputRate),
          outputRate: new Decimal(outputRate),
          multiplier,
          cacheCreationMultiplier,
          cacheReadMultiplier,
        },
      });

      await tx.oJUsageRecord.create({
        data: {
          ojApiKeyId: keyId,
          userId,
          model,
          question,
          answer,
          inputTokens,
          outputTokens,
          totalTokens,
          cacheCreationTokens,
          cacheReadTokens,
          cost: new Decimal(cost),
          ipAddress,
          responseTime,
        },
      });

      await tx.oJAPIKey.update({
        where: { id: keyId },
        data: {
          requestCount: { increment: 1 },
          totalTokens: { increment: totalTokens },
          lastUsedAt: new Date(),
        },
      });

      return true;
    });
  }

  async queryUsageStats(
    userId: string,
    page: number,
    pageSize: number,
    startTime?: Date,
    endTime?: Date,
  ): Promise<OJUsageStatsResult> {
    const where: Prisma.OJUsageRecordWhereInput = { userId, status: RECORD_STATUS.ACTIVE };
    if (startTime || endTime) {
      where.createTime = {};
      if (startTime) where.createTime.gte = startTime;
      if (endTime) where.createTime.lte = endTime;
    }

    const [total, records, stats] = await Promise.all([
      prisma.oJUsageRecord.count({ where }),
      prisma.oJUsageRecord.findMany({
        where,
        orderBy: { createTime: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          model: true,
          question: true,
          answer: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          cost: true,
          createTime: true,
        },
      }),
      prisma.oJUsageRecord.aggregate({
        where,
        _sum: { totalTokens: true, cost: true },
        _count: true,
      }),
    ]);

    return {
      total,
      records,
      totalTokens: stats._sum.totalTokens || 0,
      totalCost: Number(stats._sum.cost || 0),
      requestCount: stats._count,
    };
  }
}
