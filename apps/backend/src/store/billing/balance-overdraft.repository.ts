import type { Prisma, BalanceAccount } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import {
  BALANCE_MANAGEMENT_POLICY,
  DEFAULT_BALANCE_OVERDRAFT_CATEGORIES,
  DEFAULT_BALANCE_OVERDRAFT_RULE,
  type BalanceOverdraftCategory,
  type BalanceOverdraftRule,
} from "@quyan/shared";
import { prisma } from "@/config/database";
import { overdraftRuleSchema } from "@/api/schema/billing/balance-management.schema";
import { calculateOverdraftLimit } from "@/util/balance-overdraft-formula";

export class BalanceOverdraftRepository {
  private static instance: BalanceOverdraftRepository;
  static getInstance() {
    return (this.instance ??= new BalanceOverdraftRepository());
  }
  async defaults(tx: Prisma.TransactionClient = prisma) {
    const row = await tx.balanceOverdraftDefault.findUnique({ where: { id: BALANCE_MANAGEMENT_POLICY.defaultId } });
    return row
      ? {
          rule: overdraftRuleSchema.parse(row.rule),
          categories: row.categories as BalanceOverdraftCategory[],
          version: row.version,
        }
      : {
          rule: { ...DEFAULT_BALANCE_OVERDRAFT_RULE },
          categories: [...DEFAULT_BALANCE_OVERDRAFT_CATEGORIES],
          version: 0,
        };
  }
  async account(userId: string) {
    return prisma.balanceAccount.findUnique({ where: { userId } });
  }
  async initialize(userId: string) {
    return prisma.balanceAccount.upsert({ where: { userId }, create: { userId }, update: {} });
  }
  async resolve(account: Partial<BalanceAccount> | null, tx: Prisma.TransactionClient = prisma) {
    const defaults = await this.defaults(tx);
    const rule: BalanceOverdraftRule =
      account?.overdraftRule == null ? defaults.rule : overdraftRuleSchema.parse(account.overdraftRule);
    const categories =
      account?.overdraftCategories == null
        ? defaults.categories
        : (account.overdraftCategories as BalanceOverdraftCategory[]);
    let limit = new Decimal(0);
    let calculationError = false;
    try {
      limit = calculateOverdraftLimit(rule, {
        totalRecharged: account?.totalRecharged ?? 0,
        totalUsed: account?.totalUsed ?? 0,
      });
    } catch {
      calculationError = true;
    }
    return { rule, categories, limit, calculationError, defaultVersion: defaults.version };
  }
  async available(userId: string, category: BalanceOverdraftCategory) {
    const account = await this.account(userId);
    if (account && account.status !== 1) return false;
    const policy = await this.resolve(account);
    const limit = policy.categories.includes(category) ? policy.limit : new Decimal(0);
    const admitted = new Decimal(account?.balance ?? 0).plus(limit).gt(0);
    if (admitted && !account) await this.initialize(userId);
    return admitted;
  }
  async minimum(account: BalanceAccount, category: BalanceOverdraftCategory, tx: Prisma.TransactionClient) {
    const policy = await this.resolve(account, tx);
    return policy.categories.includes(category) ? policy.limit.negated() : new Decimal(0);
  }
}
