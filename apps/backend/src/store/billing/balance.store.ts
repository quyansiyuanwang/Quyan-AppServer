import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { BalanceAccount, BalanceTransaction, Prisma } from "@prisma/client";

export interface RechargeParams {
  iamGuard?: IamAccountUserMutationGuard;
  userId: string;
  amount: number;
  description?: string;
  countAsStatistics: boolean;
}

export interface BalanceStore {
  findAccountByUserId(userId: string): Promise<BalanceAccount | null>;
  findAccountsByUserIds(userIds: string[]): Promise<BalanceAccount[]>;
  recharge(params: RechargeParams): Promise<BalanceAccount>;
  findTransactions(
    where: Prisma.BalanceTransactionWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: BalanceTransaction[] }>;
}
