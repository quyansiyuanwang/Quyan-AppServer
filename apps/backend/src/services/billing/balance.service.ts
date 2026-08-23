import { Decimal } from "@prisma/client/runtime/library";
import { BadRequestError, NotFoundError } from "@/util/errors";
import { BalanceRepository } from "@/store/billing/balance.repository";
import { UserRepository } from "@/store/users/user.repository";
import type { BalanceStore } from "@/store/billing/balance.store";
import type { UserStore } from "@/store/users/user.store";
import { BALANCE_ACCOUNT_STATUS, RECORD_STATUS } from "@/constant/status";

const BALANCE_TRANSACTION_RETENTION_DAYS = 30;
const RETENTION_WINDOW_MS = BALANCE_TRANSACTION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export class BalanceService {
  private static instance: BalanceService;

  private constructor(
    private readonly balanceRepository: BalanceStore = BalanceRepository.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
  ) {}

  static getInstance() {
    if (!this.instance) this.instance = new BalanceService();
    return this.instance;
  }

  async getBalance(userId: string) {
    const account = await this.balanceRepository.findAccountByUserId(userId);
    if (!account)
      return {
        id: "",
        status: BALANCE_ACCOUNT_STATUS.UNINITIALIZED,
        userId,
        balance: new Decimal(0),
        totalRecharged: new Decimal(0),
        totalUsed: new Decimal(0),
        createTime: new Date(),
        updateTime: new Date(),
      };
    return account;
  }

  async getBatchBalances(userIds: string[]) {
    const accounts = await this.balanceRepository.findAccountsByUserIds(userIds);

    const accountMap = new Map(accounts.map((acc) => [acc.userId, acc]));
    return userIds.map((userId) => accountMap.get(userId) || null);
  }

  async recharge(userId: string, amount: number, description?: string, countAsStatistics = false) {
    if (amount === 0) throw new BadRequestError("Amount cannot be zero");

    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("User not found");

    return this.balanceRepository.recharge({
      userId,
      amount,
      description,
      countAsStatistics,
    });
  }

  async getTransactions(
    userId?: string,
    type?: string,
    page = 1,
    pageSize = 20,
    model?: string,
    startTime?: Date,
    endTime?: Date,
  ) {
    const cutoffTime = new Date(Date.now() - RETENTION_WINDOW_MS);
    const effectiveStart = startTime && startTime > cutoffTime ? startTime : cutoffTime;
    const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const normalizedPageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(100, Math.floor(pageSize)) : 20;

    if (endTime && endTime < effectiveStart)
      return {
        total: 0,
        records: [],
        page: normalizedPage,
        pageSize: normalizedPageSize,
      };

    const where: any = { status: RECORD_STATUS.ACTIVE };
    if (userId) where.userId = userId;
    if (type) where.type = type;
    if (model) where.model = model;
    where.createTime = { gte: effectiveStart };
    if (endTime) where.createTime.lte = endTime;

    const { total, records } = await this.balanceRepository.findTransactions(where, normalizedPage, normalizedPageSize);

    return { total, records, page: normalizedPage, pageSize: normalizedPageSize };
  }

  async getBalanceStatistics(userId: string) {
    const account = await this.balanceRepository.findAccountByUserId(userId);
    const cacheTokens = await this.balanceRepository.sumCacheTokensByUserId(userId);
    const promptTokens = cacheTokens.inputTokens + cacheTokens.cacheReadTokens;
    return {
      total: Number(account?.totalRecharged || 0),
      used: Number(account?.totalUsed || 0),
      cacheHitRate: promptTokens > 0 ? cacheTokens.cacheReadTokens / promptTokens : 0,
    };
  }
}
