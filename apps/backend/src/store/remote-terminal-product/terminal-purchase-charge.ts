import type { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { applyBalanceAccountMutation } from "@/store/billing/balance-account-mutation";
import { BadRequestError } from "@/util/errors";
/** The caller supplies the current purchase charge, never a cumulative entitlement total. */
export async function chargeTerminalPurchase(
  tx: Prisma.TransactionClient,
  data: { userId: string; purchaseAmount: number; templateName: string },
) {
  if (!Number.isFinite(data.purchaseAmount) || data.purchaseAmount < 0)
    throw new BadRequestError("Invalid terminal purchase amount", undefined, {
      messageKey: "validation.fieldInvalidValue",
      messageParams: { field: "purchaseAmount" },
    });
  if (data.purchaseAmount === 0) return;
  const mutation = await applyBalanceAccountMutation(tx, {
    userId: data.userId,
    balanceDelta: new Decimal(-data.purchaseAmount),
    totalUsedDelta: new Decimal(data.purchaseAmount),
    minimumBalance: 0,
  });
  if (!mutation)
    throw new BadRequestError("Insufficient balance", undefined, { messageKey: "billing.insufficientBalance" });
  await tx.balanceTransaction.create({
    data: {
      userId: data.userId,
      type: "remote_terminal_purchase",
      amount: new Decimal(-data.purchaseAmount),
      balanceBefore: mutation.balanceBefore,
      balanceAfter: mutation.balanceAfter,
      description: `远程终端购买: ${data.templateName}`,
      model: "remote_terminal_product",
    },
  });
}
