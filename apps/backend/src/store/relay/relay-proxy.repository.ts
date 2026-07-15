import { prisma } from "@/config/database";
import { Decimal } from "@prisma/client/runtime/library";
import { Prisma, type BalanceAccount } from "@prisma/client";
import { isMonthlyPassTemplateMatched } from "@/util/monthly-pass.util";
import { ConflictError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import { MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS, MONTHLY_PASS_QUOTA_WINDOW_MS } from "@/constant/monthly-pass";
import { MANAGED_STATUS } from "@/constant/status";
import { NotificationService } from "@/services/notification/notification.service";
import { NotificationEvent } from "@/constant/notification-event";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import type {
  RelayBalanceChargeMode,
  RelayFinalizeChargeInput,
  RelayProxyStore,
  RelayZeroChargeUsageInput,
  RelayUsageRecordInput,
} from "./relay-proxy.store";

export type { RelayUsageRecordInput, RelayZeroChargeUsageInput, RelayFinalizeChargeInput } from "./relay-proxy.store";

const round4 = (value: number): number => Math.round(value * 10000) / 10000;
const logger = getLogger("RelayProxyRepository", LogCategory.STORAGE);

const normalizeQuotaUnit = (value?: string | null): "amount" | "request" | "token" => {
  if (value === "request" || value === "token") return value;
  return "amount";
};

const resolveBalanceChargeMode = (mode?: RelayBalanceChargeMode): RelayBalanceChargeMode => {
  if (mode === "allow-negative" || mode === "skip-when-non-positive") return mode;
  return "strict";
};

export class RelayProxyRepository implements RelayProxyStore {
  private static instance: RelayProxyRepository;

  public static getInstance(): RelayProxyRepository {
    if (!RelayProxyRepository.instance) RelayProxyRepository.instance = new RelayProxyRepository();

    return RelayProxyRepository.instance;
  }

  async findBalanceAccountByUserId(userId: string): Promise<BalanceAccount | null> {
    return prisma.balanceAccount.findUnique({ where: { userId } });
  }

  async recordUsageWithoutCharge(data: RelayUsageRecordInput): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.relayUsage.create({
        data: {
          relayTokenId: data.relayTokenId,
          executionChannelId: data.executionChannelId || null,
          displayChannelId: data.displayChannelId || null,
          displayChannelName: data.displayChannelName || null,
          requestTokens: data.requestTokens,
          responseTokens: data.responseTokens,
          totalTokens: data.totalTokens,
          cacheCreationTokens: data.cacheCreationTokens,
          cacheReadTokens: data.cacheReadTokens,
          path: data.path,
          method: data.method,
          statusCode: data.statusCode,
          ipAddress: data.ipAddress,
          totalOutputTime: data.totalOutputTime,
          timeToFirstByte: data.timeToFirstByte,
          isStreaming: data.isStreaming,
        },
      });

      await tx.relayToken.update({
        where: { id: data.relayTokenId },
        data: {
          requestCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      });
    });
  }

  async recordUsageWithZeroChargeTransaction(data: RelayZeroChargeUsageInput): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const usageRecord = await tx.relayUsage.create({
        data: {
          relayTokenId: data.relayTokenId,
          executionChannelId: data.executionChannelId || null,
          displayChannelId: data.displayChannelId || null,
          displayChannelName: data.displayChannelName || null,
          requestTokens: data.requestTokens,
          responseTokens: data.responseTokens,
          totalTokens: data.totalTokens,
          cacheCreationTokens: data.cacheCreationTokens,
          cacheReadTokens: data.cacheReadTokens,
          path: data.path,
          method: data.method,
          statusCode: data.statusCode,
          ipAddress: data.ipAddress,
          totalOutputTime: data.totalOutputTime,
          timeToFirstByte: data.timeToFirstByte,
          isStreaming: data.isStreaming,
        },
      });

      const currentAccount = await tx.balanceAccount.findUnique({ where: { userId: data.userId } });
      const balanceSnapshot = currentAccount ? Number(currentAccount.balance) : 0;

      const zeroChargeDesc = data.originalModel
        ? `API调用失败(上游错误，未扣费): ${data.path} (原始: ${data.originalModel} → 扣费: ${data.modelName})`
        : data.description || `API调用失败(上游错误，未扣费): ${data.path}`;

      await tx.balanceTransaction.create({
        data: {
          userId: data.userId,
          type: "api_usage",
          amount: new Decimal(0),
          balanceBefore: new Decimal(balanceSnapshot),
          balanceAfter: new Decimal(balanceSnapshot),
          relatedId: usageRecord.id,
          description: zeroChargeDesc,
          model: data.modelName,
          tokens: data.totalTokens,
          inputTokens: data.requestTokens,
          outputTokens: data.responseTokens,
          cacheCreationTokens: data.cacheCreationTokens,
          cacheReadTokens: data.cacheReadTokens,
          inputRate: new Decimal(data.inputRate),
          outputRate: new Decimal(data.outputRate),
          multiplier: new Decimal(data.multiplier),
          cacheCreationMultiplier: data.cacheCreationMultiplier > 0 ? new Decimal(data.cacheCreationMultiplier) : null,
          cacheReadMultiplier: data.cacheReadMultiplier > 0 ? new Decimal(data.cacheReadMultiplier) : null,
          displayChannelId: data.displayChannelId || null,
          displayChannelName: data.displayChannelName || null,
          channelMultiplier: new Decimal(data.channelMultiplier),
          globalMultiplier: new Decimal(data.globalMultiplier),
          timeMultiplier: data.timeMultiplier != null ? new Decimal(data.timeMultiplier) : null,
          pricingType: data.pricingType || null,
          fixedPrice: data.fixedPrice != null ? new Decimal(data.fixedPrice) : null,
        },
      });

      await tx.relayToken.update({
        where: { id: data.relayTokenId },
        data: {
          requestCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      });
    });
  }

  async finalizeChargedUsage(data: RelayFinalizeChargeInput): Promise<{ applied: boolean }> {
    try {
      const txResult = await prisma.$transaction(
        async (tx) => {
          let remainingCost = round4(Math.max(0, data.cost));
          let coveredByMonthlyPass = 0;
          const balanceChargeMode = resolveBalanceChargeMode(data.balanceChargeMode);

          const monthlyPassAllocationPlan: Array<{
            userMonthlyPassId: string;
            coveredAmount: number;
            consumedQuota: number;
            coveredRequests: number;
            coveredTokens: number;
            remainingRequestCost: number;
          }> = [];

          if (remainingCost > 0) {
            const coverageAt = data.monthlyPassCoverageAt ?? new Date();
            const candidates = await tx.userMonthlyPass.findMany({
              where: {
                userId: data.userId,
                status: MANAGED_STATUS.ENABLED,
                remainingQuota: { gt: 0 },
                startAt: { lte: coverageAt },
                endAt: { gte: coverageAt },
                template: {
                  status: MANAGED_STATUS.ENABLED,
                },
              },
              include: {
                template: true,
              },
              orderBy: [{ endAt: "asc" }, { createTime: "asc" }],
            });

            const limitedByWindowCandidates = candidates.filter((pass) => pass.dailyQuota != null);
            const usageSummaryByPassId = new Map<
              string,
              {
                coveredAmount: number;
                coveredRequests: number;
                coveredTokens: number;
              }
            >();

            if (limitedByWindowCandidates.length > 0) {
              const windowFilters: Prisma.MonthlyPassUsageWhereInput[] = limitedByWindowCandidates.map((pass) => {
                const windowHours =
                  pass.quotaWindowHours && pass.quotaWindowHours > 0
                    ? pass.quotaWindowHours
                    : MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS;

                return {
                  userMonthlyPassId: pass.id,
                  createTime: {
                    gte: new Date(coverageAt.getTime() - windowHours * MONTHLY_PASS_QUOTA_WINDOW_MS),
                    lte: coverageAt,
                  },
                };
              });

              const grouped = await tx.monthlyPassUsage.groupBy({
                by: ["userMonthlyPassId"],
                where: {
                  status: MANAGED_STATUS.ENABLED,
                  OR: windowFilters,
                },
                _sum: {
                  coveredAmount: true,
                  coveredRequests: true,
                  coveredTokens: true,
                },
              });

              for (const item of grouped)
                usageSummaryByPassId.set(item.userMonthlyPassId, {
                  coveredAmount: Number(item._sum.coveredAmount || 0),
                  coveredRequests: Number(item._sum.coveredRequests || 0),
                  coveredTokens: Number(item._sum.coveredTokens || 0),
                });
            }

            for (const pass of candidates) {
              if (remainingCost <= 0) break;
              if (!isMonthlyPassTemplateMatched(pass.template, data.modelName, data.channelId)) continue;

              const quotaUnit = normalizeQuotaUnit(pass.quotaUnit);

              let availableQuota = Number(pass.remainingQuota);
              if (availableQuota <= 0) continue;

              if (pass.dailyQuota != null) {
                const usageSummary = usageSummaryByPassId.get(pass.id);
                let consumedInWindow = 0;

                if (quotaUnit === "request") consumedInWindow = usageSummary?.coveredRequests || 0;
                else if (quotaUnit === "token") consumedInWindow = usageSummary?.coveredTokens || 0;
                else consumedInWindow = usageSummary?.coveredAmount || 0;

                const windowRemaining = round4(Number(pass.dailyQuota) - consumedInWindow);
                if (windowRemaining <= 0) continue;
                availableQuota = Math.min(availableQuota, windowRemaining);
              }

              let coveredAmount = 0;
              let consumedQuota = 0;
              let coveredRequests = 0;
              let coveredTokens = 0;

              if (quotaUnit === "request") {
                if (availableQuota < 1) continue;
                consumedQuota = 1;
                coveredRequests = 1;
                coveredAmount = remainingCost;
              } else if (quotaUnit === "token") {
                const tokenUnitsRequested = Math.max(1, data.totalTokens);
                const tokensCanCover = Math.min(tokenUnitsRequested, Math.floor(availableQuota));
                if (tokensCanCover <= 0) continue;

                consumedQuota = tokensCanCover;
                coveredTokens = tokensCanCover;

                const coverageRatio = tokensCanCover / tokenUnitsRequested;
                coveredAmount = round4(remainingCost * coverageRatio);
              } else {
                consumedQuota = round4(Math.min(remainingCost, availableQuota));
                coveredAmount = consumedQuota;
              }

              if (coveredAmount <= 0 || consumedQuota <= 0) continue;

              coveredByMonthlyPass = round4(coveredByMonthlyPass + coveredAmount);
              remainingCost = round4(remainingCost - coveredAmount);

              monthlyPassAllocationPlan.push({
                userMonthlyPassId: pass.id,
                coveredAmount,
                consumedQuota,
                coveredRequests,
                coveredTokens,
                remainingRequestCost: remainingCost,
              });

              if (pass.dailyQuota != null) {
                const previous = usageSummaryByPassId.get(pass.id) || {
                  coveredAmount: 0,
                  coveredRequests: 0,
                  coveredTokens: 0,
                };

                usageSummaryByPassId.set(pass.id, {
                  coveredAmount: round4(previous.coveredAmount + (quotaUnit === "amount" ? consumedQuota : 0)),
                  coveredRequests: previous.coveredRequests + coveredRequests,
                  coveredTokens: previous.coveredTokens + coveredTokens,
                });
              }
            }
          }

          const shouldChargeBalance = remainingCost > 0;
          const currentAccount = await tx.balanceAccount.findUnique({ where: { userId: data.userId } });

          const balanceBefore = currentAccount ? Number(currentAccount.balance) : 0;

          if (shouldChargeBalance) {
            if (!currentAccount) return { applied: false };

            if (balanceChargeMode === "skip-when-non-positive" && balanceBefore <= 0) return { applied: false };

            if (balanceChargeMode === "strict" && (balanceBefore <= 0 || balanceBefore < remainingCost))
              return { applied: false };
          }

          let balanceAfter = balanceBefore;

          const usageRecord = await tx.relayUsage.create({
            data: {
              relayTokenId: data.relayTokenId,
              executionChannelId: data.executionChannelId || data.channelId,
              displayChannelId: data.displayChannelId || null,
              displayChannelName: data.displayChannelName || null,
              requestTokens: data.requestTokens,
              responseTokens: data.responseTokens,
              totalTokens: data.totalTokens,
              cacheCreationTokens: data.cacheCreationTokens,
              cacheReadTokens: data.cacheReadTokens,
              path: data.path,
              method: data.method,
              statusCode: data.statusCode,
              ipAddress: data.ipAddress,
              totalOutputTime: data.totalOutputTime,
              timeToFirstByte: data.timeToFirstByte,
              isStreaming: data.isStreaming,
            },
          });

          for (const plan of monthlyPassAllocationPlan) {
            // Guard against concurrent deductions: update succeeds only when quota is still sufficient.
            const quotaUpdate = await tx.userMonthlyPass.updateMany({
              where: {
                id: plan.userMonthlyPassId,
                status: MANAGED_STATUS.ENABLED,
                remainingQuota: { gte: plan.consumedQuota },
              },
              data: {
                usedQuota: { increment: plan.consumedQuota },
                remainingQuota: { decrement: plan.consumedQuota },
              },
            });

            if (quotaUpdate.count !== 1)
              throw new ConflictError("Monthly pass quota changed concurrently, please retry");

            await tx.monthlyPassUsage.create({
              data: {
                userMonthlyPassId: plan.userMonthlyPassId,
                userId: data.userId,
                relayUsageId: usageRecord.id,
                model: data.modelName,
                channelId: data.channelId,
                displayChannelId: data.displayChannelId || null,
                displayChannelName: data.displayChannelName || null,
                coveredAmount: new Decimal(plan.coveredAmount),
                coveredRequests: plan.coveredRequests,
                coveredTokens: plan.coveredTokens,
                totalRequestCost: new Decimal(data.cost),
                remainingRequestCost: new Decimal(plan.remainingRequestCost),
                description: `Monthly pass coverage for ${data.path}`,
              },
            });
          }

          const coverageDesc = data.originalModel
            ? `月卡抵扣: ${data.path} (曲${coveredByMonthlyPass}) (原始: ${data.originalModel} → 扣费: ${data.modelName})`
            : `月卡抵扣: ${data.path} (曲${coveredByMonthlyPass})`;

          if (coveredByMonthlyPass > 0)
            await tx.balanceTransaction.create({
              data: {
                userId: data.userId,
                type: "monthly_pass_coverage",
                amount: new Decimal(0),
                balanceBefore: new Decimal(balanceBefore),
                balanceAfter: new Decimal(balanceBefore),
                relatedId: usageRecord.id,
                description: coverageDesc,
                model: data.modelName,
                tokens: data.totalTokens,
                inputTokens: data.requestTokens,
                outputTokens: data.responseTokens,
                cacheCreationTokens: data.cacheCreationTokens,
                cacheReadTokens: data.cacheReadTokens,
                inputRate: new Decimal(data.inputRate),
                outputRate: new Decimal(data.outputRate),
                multiplier: new Decimal(data.multiplier),
                cacheCreationMultiplier:
                  data.cacheCreationMultiplier > 0 ? new Decimal(data.cacheCreationMultiplier) : null,
                cacheReadMultiplier: data.cacheReadMultiplier > 0 ? new Decimal(data.cacheReadMultiplier) : null,
                displayChannelId: data.displayChannelId || null,
                displayChannelName: data.displayChannelName || null,
                channelMultiplier: new Decimal(data.channelMultiplier),
                globalMultiplier: new Decimal(data.globalMultiplier),
                timeMultiplier: data.timeMultiplier != null ? new Decimal(data.timeMultiplier) : null,
                pricingType: data.pricingType || null,
                fixedPrice: data.fixedPrice != null ? new Decimal(data.fixedPrice) : null,
              },
            });

          if (shouldChargeBalance) {
            const currentTotalRecharged = Number(currentAccount!.totalRecharged);
            const currentTotalUsed = Number(currentAccount!.totalUsed);
            const newTotalUsed = currentTotalUsed + remainingCost;
            const rawBalance = currentTotalRecharged - newTotalUsed;
            const newBalance = balanceChargeMode === "skip-when-non-positive" ? Math.max(0, rawBalance) : rawBalance;

            const updatedAccount = await tx.balanceAccount.update({
              where: { userId: data.userId },
              data: {
                balance: new Decimal(newBalance),
                totalUsed: { increment: remainingCost },
              },
            });

            balanceAfter = Number(updatedAccount.balance);
          }

          const chargeDesc = data.originalModel
            ? `API调用: ${data.path} (原始: ${data.originalModel} → 扣费: ${data.modelName})`
            : `API调用: ${data.path}`;

          if (shouldChargeBalance)
            await tx.balanceTransaction.create({
              data: {
                userId: data.userId,
                type: "api_usage",
                amount: new Decimal(-remainingCost),
                balanceBefore: new Decimal(balanceBefore),
                balanceAfter: new Decimal(balanceAfter),
                relatedId: usageRecord.id,
                description: chargeDesc,
                model: data.modelName,
                tokens: data.totalTokens,
                inputTokens: data.requestTokens,
                outputTokens: data.responseTokens,
                cacheCreationTokens: data.cacheCreationTokens,
                cacheReadTokens: data.cacheReadTokens,
                inputRate: new Decimal(data.inputRate),
                outputRate: new Decimal(data.outputRate),
                multiplier: new Decimal(data.multiplier),
                cacheCreationMultiplier:
                  data.cacheCreationMultiplier > 0 ? new Decimal(data.cacheCreationMultiplier) : null,
                cacheReadMultiplier: data.cacheReadMultiplier > 0 ? new Decimal(data.cacheReadMultiplier) : null,
                displayChannelId: data.displayChannelId || null,
                displayChannelName: data.displayChannelName || null,
                channelMultiplier: new Decimal(data.channelMultiplier),
                globalMultiplier: new Decimal(data.globalMultiplier),
                timeMultiplier: data.timeMultiplier != null ? new Decimal(data.timeMultiplier) : null,
                pricingType: data.pricingType || null,
                fixedPrice: data.fixedPrice != null ? new Decimal(data.fixedPrice) : null,
              },
            });

          const usedQuotaIncrement = round4(coveredByMonthlyPass + remainingCost);

          const updatedToken = await tx.relayToken.update({
            where: { id: data.relayTokenId },
            data: {
              totalTokens: { increment: data.totalTokens },
              requestCount: { increment: 1 },
              usedQuota: { increment: new Decimal(usedQuotaIncrement) },
              lastUsedAt: new Date(),
            },
          });

          // Collect notification context for post-transaction dispatch
          const notifyContext = {
            balanceAfter,
            monthlyPassAllocations: monthlyPassAllocationPlan,
            relayTokenUsedQuota: Number(updatedToken.usedQuota),
            relayTokenQuotaLimit: updatedToken.quotaLimit ? Number(updatedToken.quotaLimit) : null,
            relayTokenName: updatedToken.name ?? "",
          };

          return { applied: true, notifyContext };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        },
      );

      // Fire-and-forget notification dispatch (outside transaction to avoid blocking)
      if (txResult.applied && txResult.notifyContext)
        this.dispatchUsageNotifications(data.userId, txResult.notifyContext).catch(() => {});

      return { applied: txResult.applied };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Concurrent billing update detected, please retry");

      logger.error("Failed to finalize charged usage", {
        userId: data.userId,
        relayTokenId: data.relayTokenId,
        modelName: data.modelName,
        channelId: data.channelId,
        cost: data.cost,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  private async dispatchUsageNotifications(
    userId: string,
    ctx: {
      balanceAfter: number;
      monthlyPassAllocations: Array<{ userMonthlyPassId: string; consumedQuota: number }>;
      relayTokenUsedQuota: number;
      relayTokenQuotaLimit: number | null;
      relayTokenName: string;
    },
  ): Promise<void> {
    try {
      const notificationService = NotificationService.getInstance();
      const prefRepo = NotificationPreferenceRepository.getInstance();
      const pref = await prefRepo.findByUserId(userId);
      if (!pref) return;

      const thresholds = (pref.thresholds as Record<string, number>) ?? {};
      const subscribedEvents = (pref.subscribedEvents as string[]) ?? [];

      // Balance low notification
      if (subscribedEvents.includes(NotificationEvent.BALANCE_LOW)) {
        const balanceThreshold = thresholds[NotificationEvent.BALANCE_LOW] ?? 10;
        if (ctx.balanceAfter < balanceThreshold)
          notificationService.dispatch(userId, NotificationEvent.BALANCE_LOW, {
            title: "余额不足提醒",
            content: `您的账户余额已低于 ${balanceThreshold} 曲，当前余额为 ${ctx.balanceAfter.toFixed(4)} 曲，请及时充值。`,
            data: { currentBalance: ctx.balanceAfter.toFixed(4), threshold: balanceThreshold },
          });
      }

      // Monthly pass quota notifications
      if (ctx.monthlyPassAllocations.length > 0) {
        const passIds = ctx.monthlyPassAllocations.map((a) => a.userMonthlyPassId);
        const passes = await prisma.userMonthlyPass.findMany({
          where: { id: { in: passIds } },
          select: {
            id: true,
            remainingQuota: true,
            totalQuota: true,
            dailyQuota: true,
            quotaWindowHours: true,
            template: { select: { name: true } },
          },
        });

        for (const pass of passes) {
          const totalQuota = Number(pass.totalQuota);
          const remainingQuota = Number(pass.remainingQuota);
          if (totalQuota <= 0) continue;

          const remainingPct = (remainingQuota / totalQuota) * 100;

          if (subscribedEvents.includes(NotificationEvent.MONTHLY_PASS_QUOTA_LOW)) {
            const quotaThreshold = thresholds[NotificationEvent.MONTHLY_PASS_QUOTA_LOW] ?? 20;
            if (remainingPct <= quotaThreshold)
              notificationService.dispatch(userId, NotificationEvent.MONTHLY_PASS_QUOTA_LOW, {
                title: "月卡额度不足提醒",
                content: `月卡「${pass.template?.name ?? pass.id}」剩余额度仅剩 ${remainingPct.toFixed(1)}%，请注意使用。`,
                data: {
                  passName: pass.template?.name ?? pass.id,
                  remainingPct: remainingPct.toFixed(1),
                  threshold: quotaThreshold,
                },
              });
          }

          // Monthly pass daily limit notification
          if (subscribedEvents.includes(NotificationEvent.MONTHLY_PASS_DAILY_LIMIT) && pass.dailyQuota != null) {
            const dailyQuota = Number(pass.dailyQuota);
            if (dailyQuota > 0) {
              const allocation = ctx.monthlyPassAllocations.find((a) => a.userMonthlyPassId === pass.id);
              if (allocation) {
                // Re-query window usage to get accurate consumed amount
                const windowHours =
                  pass.quotaWindowHours && pass.quotaWindowHours > 0
                    ? pass.quotaWindowHours
                    : MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS;
                const windowStart = new Date(Date.now() - windowHours * MONTHLY_PASS_QUOTA_WINDOW_MS);
                const usageSummary = await prisma.monthlyPassUsage.aggregate({
                  where: {
                    userMonthlyPassId: pass.id,
                    status: MANAGED_STATUS.ENABLED,
                    createTime: { gte: windowStart },
                  },
                  _sum: { coveredAmount: true },
                });
                const consumedInWindow = Number(usageSummary._sum.coveredAmount || 0);
                const usedPct = (consumedInWindow / dailyQuota) * 100;
                const dailyThreshold = thresholds[NotificationEvent.MONTHLY_PASS_DAILY_LIMIT] ?? 80;
                if (usedPct >= dailyThreshold)
                  notificationService.dispatch(userId, NotificationEvent.MONTHLY_PASS_DAILY_LIMIT, {
                    title: "月卡日限额提醒",
                    content: `月卡「${pass.template?.name ?? pass.id}」今日已使用 ${usedPct.toFixed(1)}%，已达到设定阈值 ${dailyThreshold}%。`,
                    data: {
                      passName: pass.template?.name ?? pass.id,
                      usedPct: usedPct.toFixed(1),
                      threshold: dailyThreshold,
                    },
                  });
              }
            }
          }
        }
      }

      // Relay token quota notification
      if (
        subscribedEvents.includes(NotificationEvent.RELAY_TOKEN_QUOTA_LOW) &&
        ctx.relayTokenQuotaLimit !== null &&
        ctx.relayTokenQuotaLimit > 0
      ) {
        const usedPct = (ctx.relayTokenUsedQuota / ctx.relayTokenQuotaLimit) * 100;
        const quotaThreshold = thresholds[NotificationEvent.RELAY_TOKEN_QUOTA_LOW] ?? 80;
        if (usedPct >= quotaThreshold)
          notificationService.dispatch(userId, NotificationEvent.RELAY_TOKEN_QUOTA_LOW, {
            title: "中转令牌额度提醒",
            content: `您的中转令牌已使用 ${usedPct.toFixed(1)}%，已达到设定阈值 ${quotaThreshold}%。`,
            data: {
              usedPct: usedPct.toFixed(1),
              threshold: quotaThreshold,
            },
          });
      }

      // Relay token exhausted notification
      if (
        subscribedEvents.includes(NotificationEvent.RELAY_TOKEN_EXHAUSTED) &&
        ctx.relayTokenQuotaLimit !== null &&
        ctx.relayTokenQuotaLimit > 0 &&
        ctx.relayTokenUsedQuota >= ctx.relayTokenQuotaLimit
      )
        notificationService.dispatch(userId, NotificationEvent.RELAY_TOKEN_EXHAUSTED, {
          title: "中转令牌额度耗尽",
          content: `您的中转令牌「${ctx.relayTokenName}」额度已全部用完（${ctx.relayTokenUsedQuota.toFixed(4)} / ${ctx.relayTokenQuotaLimit.toFixed(4)}），请及时充值或更换令牌。`,
          data: {
            tokenName: ctx.relayTokenName,
            usedQuota: ctx.relayTokenUsedQuota.toFixed(4),
            quotaLimit: ctx.relayTokenQuotaLimit.toFixed(4),
          },
        });
    } catch (err) {
      logger.warn(`[RelayProxyRepository] Notification dispatch error for user ${userId}: ${(err as Error).message}`);
    }
  }
}
