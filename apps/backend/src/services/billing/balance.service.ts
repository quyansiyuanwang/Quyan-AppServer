import { IamAccountUserMutationService } from "@/services/users/iam-account-user-mutation.service";
import { env } from "@/config/env";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { IamAccountUserAuthorizationService } from "@/services/users/iam-account-user-authorization.service";
import { PermissionService } from "@/services/users/permission.service";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
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
    private readonly userIam = IamAccountUserAuthorizationService.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
    private readonly userMutationIam = IamAccountUserMutationService.getInstance(),
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

  private async legacyRead(request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!principal || principal.subjectUserId !== principal.principalUserId) throw iamAccountDenied();
    const result = await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.BALANCE_READ], {
      assumedRoleSessionId: principal.roleSessionId,
    });
    if (!result.hasPermission) throw iamAccountDenied();
  }
  private async shadowRead(operation: () => Promise<unknown>, request?: TypedRequest) {
    if (env.security.iamAuthorizationMode !== "shadow" || !request) return;
    try {
      await operation();
    } catch {
      getLogger("BalanceReadIamBridge", LogCategory.SECURITY).warn("Balance IAM shadow read denied", {
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
  }
  async getManagedBalance(userId: string, request?: TypedRequest) {
    const action = "quyan:balance:GetUserBalance";
    if (env.security.iamAuthorizationMode === "enforce")
      return this.userIam.read(action, userId, request, async (id) => {
        const row = await this.getBalance(id);
        if (row.userId !== id) throw iamAccountDenied();
        return row;
      });
    await this.legacyRead(request);
    await this.shadowRead(() => this.userIam.authorize(action, userId, request), request);
    return this.getBalance(userId);
  }
  async getManagedBatchBalances(userIds: string[], request?: TypedRequest) {
    const action = "quyan:balance:GetUserBalance";
    if (env.security.iamAuthorizationMode === "enforce")
      return this.userIam.readMany(action, userIds, request, async (ids) => {
        const rows = await this.getBatchBalances(ids);
        if (rows.some((row) => row && !ids.includes(row.userId))) throw iamAccountDenied();
        return rows;
      });
    await this.legacyRead(request);
    await this.shadowRead(() => this.userIam.authorizeMany(action, userIds, request), request);
    return this.getBatchBalances(userIds);
  }
  async rechargeManaged(
    userId: string,
    amount: number,
    description?: string,
    countAsStatistics = false,
    request?: TypedRequest,
  ) {
    if (amount === 0)
      throw new BadRequestError("Invalid recharge amount", undefined, { messageKey: "billing.amountCannotBeZero" });
    if (!Number.isFinite(amount))
      throw new BadRequestError("Invalid recharge amount", undefined, { messageKey: "errors.badRequest" });
    const action = "quyan:balance:RechargeUserBalance";
    if (env.security.iamAuthorizationMode === "enforce") {
      const iamGuard = await this.userMutationIam.prepare(action, userId, request);
      return this.balanceRepository.recharge({ userId, amount, description, countAsStatistics, iamGuard });
    }
    const principal = request && getIamPrincipal(request);
    if (!principal || principal.subjectUserId !== principal.principalUserId) throw iamAccountDenied();
    if (
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.BALANCE_RECHARGE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    await this.shadowRead(() => this.userMutationIam.prepare(action, userId, request), request);
    return this.recharge(userId, amount, description, countAsStatistics);
  }
  async recharge(userId: string, amount: number, description?: string, countAsStatistics = false) {
    if (amount === 0)
      throw new BadRequestError("Amount cannot be zero", undefined, { messageKey: "billing.amountCannotBeZero" });

    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("User not found", undefined, { messageKey: "user.notFound" });

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
    return {
      total: Number(account?.totalRecharged || 0),
      used: Number(account?.totalUsed || 0),
    };
  }
}
