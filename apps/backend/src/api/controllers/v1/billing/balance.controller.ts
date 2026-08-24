import {
  Controller,
  Delete,
  Get,
  Post,
  Route,
  Security,
  Body,
  Query,
  Request,
  Path,
  Tags,
  Middlewares,
} from "@tsoa/runtime";
import { BalanceService } from "@/services/billing/balance.service";
import type {
  BalanceAccountResponse,
  BalanceTransactionCategory,
  RechargeRequest,
  TransactionListResponse,
} from "@/api/dto/billing/balance.dto";
import type {
  BalanceGiftCodeDto,
  BalanceGiftCodeListResponse,
  BalanceTransferConfigDto,
  BalanceTransferResponse,
  CancelBalanceGiftCodeResponse,
  CreateBalanceGiftCodeDto,
  CreateBalanceTransferDto,
} from "@/api/dto/billing/balance-transfer.dto";
import type { UserBalanceResponse } from "@/api/dto/billing/user-balance.dto";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { BalanceTransaction } from "@prisma/client";
import type { TypedRequest } from "@/types/express";
import { RelayUsageRepository } from "@/store/relay/relay-usage.repository";
import {
  balanceAllTransactionsQuerySchema,
  balanceTransactionsQuerySchema,
  balanceUserIdParamsSchema,
  batchBalanceAccountsBodySchema,
  rechargeBodySchema,
} from "@/api/schema/billing/balance.schema";
import {
  balanceGiftCodeListQuerySchema,
  balanceGiftCodeParamsSchema,
  createBalanceGiftCodeBodySchema,
  createBalanceTransferBodySchema,
} from "@/api/schema/billing/balance-transfer.schema";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { isMonthlyPassCoverageDescription } from "@/util/monthly-pass-coverage.util";
import { normalizeRelayDisplaySnapshotName } from "@/util/relay-display-channel.util";
import { BalanceTransferService } from "@/services/billing/balance-transfer.service";
import { RelayChannelService } from "@/services/relay/relay-channel.service";

type UsageDataMap = Map<
  string,
  {
    totalOutputTime: number | null;
    timeToFirstByte: number | null;
    isStreaming: boolean;
    requestId: string | null;
    displayChannelName: string | null;
    automaticPoolDisplayChannelName: string | null;
    isAutomaticPoolUsage: boolean;
    hideDisplayChannel: boolean;
    legacyMonthlyPassChannelName: string | null;
  }
>;

type TransferDisplayDataMap = Map<
  string,
  {
    senderUsername: string;
    recipientUsername: string;
    description: string | null;
  }
>;

@Route("v1/balance")
@Tags("Balance")
export class BalanceController extends Controller {
  private balanceService = BalanceService.getInstance();
  private balanceTransferService = BalanceTransferService.getInstance();
  private relayUsageRepository = RelayUsageRepository.getInstance();
  private relayChannelService = RelayChannelService.getInstance();

  private isChatUsageDescription(description?: string | null): boolean {
    if (!description) return false;
    if (description.startsWith("AI对话 -") || description.startsWith("Web Chat -")) return true;

    if (!description.startsWith("API调用:")) return false;

    const path = description.slice("API调用:".length).trim().toLowerCase();
    return path.startsWith("/chat/conversations/");
  }

  private isMonthlyPassCoverageDescription(description?: string | null): boolean {
    return isMonthlyPassCoverageDescription(description);
  }

  private resolveTransactionCategory(r: BalanceTransaction): BalanceTransactionCategory {
    if (r.type === "monthly_pass_coverage" || this.isMonthlyPassCoverageDescription(r.description))
      return "monthly_pass_coverage";

    if (r.type === "redemption") return "redemption";
    if (r.type === "channel_commission") return "channel_commission";
    if (
      r.type === "gift_code_create" ||
      r.type === "gift_code_redeem" ||
      r.type === "gift_code_cancel" ||
      r.type === "peer_transfer_out" ||
      r.type === "peer_transfer_in"
    )
      return r.type;

    const isUsageLike =
      r.type === "api_usage" ||
      (r.type === "recharge" &&
        Number(r.amount) < 0 &&
        !this.isMonthlyPassCoverageDescription(r.description) &&
        (Boolean(r.model) || this.isChatUsageDescription(r.description)));

    if (isUsageLike) return this.isChatUsageDescription(r.description) ? "chat_usage" : "api_usage";

    return "recharge";
  }

  private async buildUsageMaps(relatedIds: string[]): Promise<{
    tokenNameMap: Map<string, string>;
    usageDataMap: UsageDataMap;
  }> {
    const tokenNameMap = new Map<string, string>();
    const usageDataMap: UsageDataMap = new Map();

    const usages = await this.relayUsageRepository.findByIdsWithTokenName(relatedIds);
    const automaticDisplayChannels = new Map<string, string | null>();
    const automaticUsageKeys = new Map<string, { executionChannelId: string; userId: string }>();

    for (const usage of usages) {
      const relayToken = usage.relayToken;
      const storedDisplayChannelName = normalizeRelayDisplaySnapshotName(usage.displayChannelName);
      const needsRecovery =
        relayToken?.routingMode === "automatic-pool" &&
        Boolean(usage.executionChannelId) &&
        (usage.displayChannelId === relayToken.automaticProxyPoolChannelId || !storedDisplayChannelName);
      if (!needsRecovery || !usage.executionChannelId || !relayToken) continue;

      const key = `${relayToken.userId}\u0000${usage.executionChannelId}`;
      automaticUsageKeys.set(key, { executionChannelId: usage.executionChannelId, userId: relayToken.userId });
    }

    await Promise.all(
      [...automaticUsageKeys].map(async ([key, { executionChannelId, userId }]) => {
        const channel = await this.relayChannelService.resolveAutomaticPoolUsageDisplayChannelById(
          executionChannelId,
          userId,
        );
        automaticDisplayChannels.set(key, channel?.name?.trim() || null);
      }),
    );

    usages.forEach((u) => {
      if (u.relayToken?.name) tokenNameMap.set(u.id, u.relayToken.name);
      const legacyMonthlyPassChannelNames = new Set(
        u.monthlyPassUsages.map((usage) => usage.channelName?.trim()).filter((name): name is string => Boolean(name)),
      );
      const relayToken = u.relayToken;
      const storedDisplayChannelName = normalizeRelayDisplaySnapshotName(u.displayChannelName) || null;
      const needsRecovery =
        relayToken?.routingMode === "automatic-pool" &&
        Boolean(u.executionChannelId) &&
        (u.displayChannelId === relayToken.automaticProxyPoolChannelId || !storedDisplayChannelName);
      const automaticUsageKey =
        relayToken?.routingMode === "automatic-pool" && u.executionChannelId
          ? `${relayToken.userId}\u0000${u.executionChannelId}`
          : null;
      const isAutomaticPoolUsage = relayToken?.routingMode === "automatic-pool";
      usageDataMap.set(u.id, {
        totalOutputTime: u.totalOutputTime,
        timeToFirstByte: u.timeToFirstByte,
        isStreaming: u.isStreaming,
        requestId: u.logicalRequest?.requestId || null,
        displayChannelName: storedDisplayChannelName,
        automaticPoolDisplayChannelName:
          needsRecovery && automaticUsageKey && automaticDisplayChannels.has(automaticUsageKey)
            ? automaticDisplayChannels.get(automaticUsageKey) || null
            : storedDisplayChannelName,
        isAutomaticPoolUsage,
        hideDisplayChannel: !isAutomaticPoolUsage && u.hasHiddenDisplayChannel,
        legacyMonthlyPassChannelName:
          legacyMonthlyPassChannelNames.size === 1 ? [...legacyMonthlyPassChannelNames][0] : null,
      });
    });

    return { tokenNameMap, usageDataMap };
  }

  private async buildTransferDisplayDataMap(relatedIds: string[]): Promise<TransferDisplayDataMap> {
    const records = await this.balanceTransferService.getTransferDisplayRecords(relatedIds);
    return new Map(records.map((record) => [record.id, record]));
  }

  private resolveTransferDescription(
    transaction: BalanceTransaction,
    transferDataMap: TransferDisplayDataMap,
  ): string | undefined {
    if (!transaction.relatedId) return transaction.description || undefined;

    const transfer = transferDataMap.get(transaction.relatedId);
    if (!transfer) return transaction.description || undefined;

    const note = transfer.description?.trim();
    if (transaction.type === "peer_transfer_in")
      return `来自用户 ${transfer.senderUsername} 的转账${note ? `：${note}` : ""}`;
    if (transaction.type === "peer_transfer_out")
      return `转账给用户 ${transfer.recipientUsername}${note ? `：${note}` : ""}`;

    return transaction.description || undefined;
  }

  private mapTransactionRecord(
    r: BalanceTransaction,
    tokenNameMap: Map<string, string>,
    usageDataMap: UsageDataMap,
    transferDataMap: TransferDisplayDataMap,
  ): TransactionListResponse["records"][number] {
    const usageData = r.relatedId ? usageDataMap.get(r.relatedId) : undefined;
    const category = this.resolveTransactionCategory(r);
    const storedDisplayChannelName =
      normalizeRelayDisplaySnapshotName(r.displayChannelName) ||
      normalizeRelayDisplaySnapshotName(usageData?.displayChannelName);
    const displayChannelName = usageData?.isAutomaticPoolUsage
      ? usageData.automaticPoolDisplayChannelName || undefined
      : usageData?.hideDisplayChannel
        ? undefined
        : r.channelName?.trim() || usageData?.legacyMonthlyPassChannelName || storedDisplayChannelName || undefined;

    const isUsageLike = category === "api_usage" || category === "chat_usage" || category === "monthly_pass_coverage";
    const inputTokens = r.inputTokens == null ? null : Number(r.inputTokens);
    const cacheReadTokens = r.cacheReadTokens == null ? null : Number(r.cacheReadTokens);
    const cacheHitRate =
      isUsageLike &&
      inputTokens != null &&
      cacheReadTokens != null &&
      Number.isFinite(inputTokens) &&
      Number.isFinite(cacheReadTokens) &&
      inputTokens >= 0 &&
      cacheReadTokens >= 0 &&
      inputTokens + cacheReadTokens > 0
        ? Math.min(1, Math.max(0, cacheReadTokens / (inputTokens + cacheReadTokens)))
        : null;

    return {
      id: r.id,
      userId: r.userId,
      type: r.type,
      category,
      amount: Number(r.amount),
      balanceBefore: Number(r.balanceBefore),
      balanceAfter: Number(r.balanceAfter),
      description: this.resolveTransferDescription(r, transferDataMap),
      model: r.model || undefined,
      tokens: r.tokens ?? undefined,
      inputTokens: r.inputTokens ?? undefined,
      outputTokens: r.outputTokens ?? undefined,
      cacheCreationTokens: r.cacheCreationTokens ?? undefined,
      cacheReadTokens: r.cacheReadTokens ?? undefined,
      cacheHitRate,
      inputRate: r.inputRate != null ? Number(r.inputRate) : undefined,
      outputRate: r.outputRate != null ? Number(r.outputRate) : undefined,
      multiplier: r.multiplier != null ? Number(r.multiplier) : undefined,
      cacheCreationMultiplier: r.cacheCreationMultiplier != null ? Number(r.cacheCreationMultiplier) : undefined,
      cacheReadMultiplier: r.cacheReadMultiplier != null ? Number(r.cacheReadMultiplier) : undefined,
      requestId: usageData?.requestId || undefined,
      pricingType: r.pricingType === "token-based" || r.pricingType === "per-request" ? r.pricingType : undefined,
      fixedPrice: r.fixedPrice != null ? Number(r.fixedPrice) : undefined,
      displayChannelName,
      channelMultiplier: r.channelMultiplier != null ? Number(r.channelMultiplier) : undefined,
      globalMultiplier: r.globalMultiplier != null ? Number(r.globalMultiplier) : undefined,
      timeMultiplier: r.timeMultiplier != null ? Number(r.timeMultiplier) : undefined,
      contextTokens: r.contextTokens ?? undefined,
      contextMultiplier: r.contextMultiplier != null ? Number(r.contextMultiplier) : undefined,
      contextRuleName: r.contextRuleName || undefined,
      tokenName: r.relatedId ? tokenNameMap.get(r.relatedId) || undefined : undefined,
      totalOutputTime: usageData?.totalOutputTime ?? undefined,
      timeToFirstByte: usageData?.timeToFirstByte ?? undefined,
      isStreaming: usageData?.isStreaming,
      createTime: r.createTime,
    };
  }

  @Get("account")
  @Security("jwt")
  public async getMyBalance(@Request() request: TypedRequest): Promise<BalanceAccountResponse> {
    const userId = request.user!.userId;
    const account = await this.balanceService.getBalance(userId);
    return {
      id: account.id,
      userId: account.userId,
      balance: Math.floor(Number(account.balance) * 10000) / 10000,
      createTime: account.createTime,
      updateTime: account.updateTime,
    };
  }

  @Get("usage")
  @Security("jwt")
  public async getUsage(@Request() request: TypedRequest): Promise<UserBalanceResponse> {
    const userId = request.user!.userId;
    const account = await this.balanceService.getBalance(userId);
    const balance = Math.floor(Number(account.balance) * 10000) / 10000;
    const statistics = await this.balanceService.getBalanceStatistics(userId);

    return {
      isValid: balance > 0,
      invalidMessage: balance <= 0 ? "Insufficient balance" : undefined,
      remaining: balance,
      unit: "曲",
      total: statistics.total,
      used: statistics.used,
    };
  }

  @Get("account/{userId}")
  @Security("jwt")
  @RequirePermission(Permission.BALANCE_READ)
  @Middlewares(validateParams(balanceUserIdParamsSchema))
  public async getUserBalance(@Path() userId: string): Promise<BalanceAccountResponse> {
    const account = await this.balanceService.getBalance(userId);
    return {
      id: account.id,
      userId: account.userId,
      balance: Math.floor(Number(account.balance) * 10000) / 10000,
      createTime: account.createTime,
      updateTime: account.updateTime,
    };
  }

  @Post("accounts/batch")
  @Security("jwt")
  @RequirePermission(Permission.BALANCE_READ)
  @Middlewares(replayProtectionMiddleware, validateBody(batchBalanceAccountsBodySchema))
  public async getBatchBalances(@Body() body: { userIds: string[] }): Promise<BalanceAccountResponse[]> {
    const accounts = await this.balanceService.getBatchBalances(body.userIds);
    return accounts
      .map((account) => {
        if (!account) return null;
        return {
          id: account.id,
          userId: account.userId,
          balance: Math.floor(Number(account.balance) * 10000) / 10000,
          createTime: account.createTime,
          updateTime: account.updateTime,
        };
      })
      .filter(Boolean) as BalanceAccountResponse[];
  }

  @Post("recharge")
  @Security("jwt")
  @RequirePermission(Permission.BALANCE_RECHARGE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(rechargeBodySchema),
  )
  public async recharge(@Body() body: RechargeRequest): Promise<BalanceAccountResponse> {
    const account = await this.balanceService.recharge(
      body.userId,
      body.amount,
      body.description,
      body.countAsStatistics,
    );
    return {
      id: account.id,
      userId: account.userId,
      balance: Math.floor(Number(account.balance) * 10000) / 10000,
      createTime: account.createTime,
      updateTime: account.updateTime,
    };
  }

  @Get("transfers/config")
  @Security("jwt")
  public async getTransferConfig(@Request() _request: TypedRequest): Promise<BalanceTransferConfigDto> {
    return await this.balanceTransferService.getConfig();
  }

  @Post("gift-codes")
  @Security("jwt")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createBalanceGiftCodeBodySchema),
  )
  public async createGiftCode(
    @Body() body: CreateBalanceGiftCodeDto,
    @Request() request: TypedRequest,
  ): Promise<BalanceGiftCodeDto> {
    return await this.balanceTransferService.createGiftCode(body, request.user!.userId, request);
  }

  @Get("gift-codes")
  @Security("jwt")
  @Middlewares(validateQuery(balanceGiftCodeListQuerySchema))
  public async getMyGiftCodes(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<BalanceGiftCodeListResponse> {
    return await this.balanceTransferService.listGiftCodes(request.user!.userId, page, pageSize);
  }

  @Delete("gift-codes/{id}")
  @Security("jwt")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(balanceGiftCodeParamsSchema),
  )
  public async cancelGiftCode(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<CancelBalanceGiftCodeResponse> {
    return await this.balanceTransferService.cancelGiftCode(id, request.user!.userId, request);
  }

  @Post("transfers")
  @Security("jwt")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createBalanceTransferBodySchema),
  )
  public async createTransfer(
    @Body() body: CreateBalanceTransferDto,
    @Request() request: TypedRequest,
  ): Promise<BalanceTransferResponse> {
    return await this.balanceTransferService.createTransfer(body, request.user!.userId, request);
  }

  @Get("transactions")
  @Security("jwt")
  @Middlewares(validateQuery(balanceTransactionsQuerySchema))
  public async getMyTransactions(
    @Query() type?: string,
    @Query() limit?: number,
    @Query() offset?: number,
    @Query() model?: string,
    @Query() tokenName?: string,
    @Query() startTime?: string,
    @Query() endTime?: string,
    @Request() request?: TypedRequest,
  ): Promise<TransactionListResponse> {
    const userId = request!.user!.userId;
    const pageSize = limit || 20;
    const page = offset ? Math.floor(offset / pageSize) + 1 : 1;
    const start = startTime ? new Date(startTime) : undefined;
    const end = endTime ? new Date(endTime) : undefined;
    const result = await this.balanceService.getTransactions(userId, type, page, pageSize, model, start, end);

    const relatedIds = result.records.filter((r) => r.relatedId).map((r) => r.relatedId!);
    const transferIds = result.records
      .filter((r) => (r.type === "peer_transfer_in" || r.type === "peer_transfer_out") && r.relatedId)
      .map((r) => r.relatedId!);
    const [{ tokenNameMap, usageDataMap }, transferDataMap] = await Promise.all([
      this.buildUsageMaps(relatedIds),
      this.buildTransferDisplayDataMap(transferIds),
    ]);

    let filteredRecords = result.records;
    if (tokenName)
      filteredRecords = filteredRecords.filter((r) => r.relatedId && tokenNameMap.get(r.relatedId) === tokenName);

    return {
      ...result,
      records: filteredRecords.map((r) => this.mapTransactionRecord(r, tokenNameMap, usageDataMap, transferDataMap)),
    };
  }

  @Get("transactions/all")
  @Security("jwt")
  @RequirePermission(Permission.BALANCE_READ)
  @Middlewares(validateQuery(balanceAllTransactionsQuerySchema))
  public async getAllTransactions(
    @Query() userId?: string,
    @Query() type?: string,
    @Query() limit?: number,
    @Query() offset?: number,
    @Query() model?: string,
    @Query() tokenName?: string,
    @Query() startTime?: string,
    @Query() endTime?: string,
  ): Promise<TransactionListResponse> {
    const start = startTime ? new Date(startTime) : undefined;
    const end = endTime ? new Date(endTime) : undefined;

    const pageSize = limit || 20;
    const page = offset ? Math.floor(offset / pageSize) + 1 : 1;
    const result = await this.balanceService.getTransactions(userId, type, page, pageSize, model, start, end);

    const relatedIds = result.records.filter((r) => r.relatedId).map((r) => r.relatedId!);
    const transferIds = result.records
      .filter((r) => (r.type === "peer_transfer_in" || r.type === "peer_transfer_out") && r.relatedId)
      .map((r) => r.relatedId!);
    const [{ tokenNameMap, usageDataMap }, transferDataMap] = await Promise.all([
      this.buildUsageMaps(relatedIds),
      this.buildTransferDisplayDataMap(transferIds),
    ]);

    let filteredRecords = result.records;
    if (tokenName)
      filteredRecords = filteredRecords.filter((r) => r.relatedId && tokenNameMap.get(r.relatedId) === tokenName);

    return {
      ...result,
      records: filteredRecords.map((r) => this.mapTransactionRecord(r, tokenNameMap, usageDataMap, transferDataMap)),
    };
  }
}
