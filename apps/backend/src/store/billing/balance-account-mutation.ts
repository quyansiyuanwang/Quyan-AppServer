import { Decimal } from "@prisma/client/runtime/library";
import { Prisma, type BalanceAccount } from "@prisma/client";

export type BalanceTransactionClient = Prisma.TransactionClient;

export interface BalanceAccountMutationInput {
  userId: string;
  balanceDelta: Decimal.Value;
  totalRechargedDelta?: Decimal.Value;
  totalUsedDelta?: Decimal.Value;
  totalCommissionEarnedDelta?: Decimal.Value;
  createIfMissing?: boolean;
  requireActive?: boolean;
  minimumBalance?: Decimal.Value;
  clampMinimumBalance?: Decimal.Value;
}

export interface BalanceAccountMutationResult {
  balanceBefore: Decimal;
  balanceAfter: Decimal;
  account: BalanceAccount;
}

const zero = new Decimal(0);

const toDecimal = (value: Decimal.Value | undefined): Decimal => new Decimal(value ?? 0);

/**
 * Locks a balance account before applying a mutation. All account writers use this
 * module so an absolute balance write cannot overwrite a concurrent settlement.
 */
export const lockBalanceAccount = async (tx: BalanceTransactionClient, userId: string, createIfMissing = false) => {
  if (createIfMissing)
    await tx.balanceAccount.upsert({
      where: { userId },
      create: { userId, balance: zero },
      update: {},
    });

  if (typeof tx.$queryRaw === "function")
    await tx.$queryRaw(Prisma.sql`SELECT id FROM balance_accounts WHERE userId = ${userId} FOR UPDATE`);
  return tx.balanceAccount.findUnique({ where: { userId } });
};

export const lockBalanceAccounts = async (
  tx: BalanceTransactionClient,
  accounts: Array<{ userId: string; createIfMissing?: boolean }>,
) => {
  const uniqueAccounts = [...new Map(accounts.map((account) => [account.userId, account])).values()].sort(
    (left, right) => left.userId.localeCompare(right.userId),
  );

  for (const account of uniqueAccounts)
    if (account.createIfMissing)
      await tx.balanceAccount.upsert({
        where: { userId: account.userId },
        create: { userId: account.userId, balance: zero },
        update: {},
      });

  if (uniqueAccounts.length && typeof tx.$queryRaw === "function")
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM balance_accounts WHERE userId IN (${Prisma.join(
        uniqueAccounts.map((account) => account.userId),
      )}) ORDER BY userId FOR UPDATE`,
    );

  const locked = await tx.balanceAccount.findMany({
    where: { userId: { in: uniqueAccounts.map((account) => account.userId) } },
  });
  return new Map(locked.map((account) => [account.userId, account]));
};

export const applyBalanceAccountMutation = async (
  tx: BalanceTransactionClient,
  input: BalanceAccountMutationInput,
): Promise<BalanceAccountMutationResult | null> => {
  const account = await lockBalanceAccount(tx, input.userId, input.createIfMissing);
  // Keep adapters that omit the legacy status field compatible; persisted
  // Prisma accounts always have a numeric status and still reject non-active
  // accounts when requireActive is requested.
  if (!account || (input.requireActive && account.status != null && account.status !== 1)) return null;

  const balanceBefore = new Decimal(account.balance);
  let balanceAfter = balanceBefore.plus(toDecimal(input.balanceDelta));
  const minimumBalance = input.minimumBalance == null ? undefined : toDecimal(input.minimumBalance);
  if (minimumBalance && balanceAfter.lessThan(minimumBalance)) return null;
  const clampMinimumBalance = input.clampMinimumBalance == null ? undefined : toDecimal(input.clampMinimumBalance);
  if (clampMinimumBalance && balanceAfter.lessThan(clampMinimumBalance)) balanceAfter = clampMinimumBalance;

  const totalRechargedDelta = toDecimal(input.totalRechargedDelta);
  const totalUsedDelta = toDecimal(input.totalUsedDelta);
  const totalCommissionEarnedDelta = toDecimal(input.totalCommissionEarnedDelta);
  const data: Prisma.BalanceAccountUpdateInput = {
    balance:
      clampMinimumBalance != null && balanceAfter.equals(clampMinimumBalance)
        ? balanceAfter
        : { increment: toDecimal(input.balanceDelta) },
    ...(totalRechargedDelta.equals(zero) ? {} : { totalRecharged: { increment: totalRechargedDelta } }),
    ...(totalUsedDelta.equals(zero) ? {} : { totalUsed: { increment: totalUsedDelta } }),
    ...(totalCommissionEarnedDelta.equals(zero)
      ? {}
      : { totalCommissionEarned: { increment: totalCommissionEarnedDelta } }),
  };
  // Prisma's update operation returns the updated account. Some lightweight
  // transaction clients (and older repository adapters) only expose
  // updateMany, or return void from update; retain a compatible fallback while
  // keeping the real client on the row-locked update path above.
  let updated: BalanceAccount | null | undefined =
    typeof tx.balanceAccount.update === "function"
      ? await tx.balanceAccount.update({ where: { userId: input.userId }, data })
      : undefined;
  if (!updated && typeof tx.balanceAccount.updateMany === "function") {
    await tx.balanceAccount.updateMany({ where: { userId: input.userId }, data });
    updated = await tx.balanceAccount.findUnique({ where: { userId: input.userId } });
  }
  if (!updated) return null;

  return { balanceBefore, balanceAfter: new Decimal(updated.balance), account: updated };
};
