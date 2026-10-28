import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError } from "@/util/errors";
import { applyBalanceAccountMutation } from "../billing/balance-account-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";

export interface ProviderSettlementWriteGuard {
  checkGenerated(kind: "settlement" | "transaction", id: string): Promise<void>;
}
/** The shared financial writer for realtime, scheduled and user-requested settlements. */
export async function settleProviderEarnings(
  tx: Prisma.TransactionClient,
  providerId: string,
  earningIds: string[],
  mode: string,
  guard?: ProviderSettlementWriteGuard,
): Promise<{ id: string; amount: number }> {
  const provider = await tx.relayChannelProvider.findUnique({ where: { id: providerId } });
  if (!provider)
    throw new NotFoundError("Relay channel provider not found", undefined, {
      messageKey: "relay.channelProviderNotFound",
    });
  const earnings = await tx.relayChannelProviderEarning.findMany({
    where: { id: { in: earningIds }, providerId, settlementId: null, status: 1 },
    select: { id: true, commissionAmount: true },
  });
  if (!earnings.length)
    throw new ConflictError("Channel revenue has already been settled", undefined, {
      messageKey: "relay.revenueAlreadySettled",
    });
  if (guard && earnings.length !== new Set(earningIds).size) throw iamAccountDenied();
  const amount = Number(
    earnings.reduce((sum, earning) => sum.add(earning.commissionAmount), new Decimal(0)).toFixed(4),
  );
  const mutation = await applyBalanceAccountMutation(tx, {
    userId: provider.userId,
    balanceDelta: new Decimal(amount),
    totalCommissionEarnedDelta: new Decimal(amount),
    createIfMissing: true,
  });
  if (!mutation)
    throw new ConflictError("Channel revenue settlement balance mutation failed", undefined, {
      messageKey: "relay.revenueBalanceMutationFailed",
    });
  const settlement = await tx.relayChannelProviderSettlement.create({
    data: { providerId, amount: new Decimal(amount), settlementMode: mode },
  });
  if (guard) await guard.checkGenerated("settlement", settlement.id);
  const balanceTransaction = await tx.balanceTransaction.create({
    data: {
      userId: provider.userId,
      type: "channel_commission",
      amount: new Decimal(amount),
      balanceBefore: mutation.balanceBefore,
      balanceAfter: mutation.balanceAfter,
      relatedId: settlement.id,
      description: "渠道提供分成结算",
    },
  });
  if (guard) await guard.checkGenerated("transaction", balanceTransaction.id);
  await tx.relayChannelProviderSettlement.update({
    where: { id: settlement.id },
    data: { balanceTransactionId: balanceTransaction.id },
  });
  const updated = await tx.relayChannelProviderEarning.updateMany({
    where: { id: { in: earnings.map((earning) => earning.id) }, settlementId: null },
    data: { settlementId: settlement.id, settledAt: new Date() },
  });
  if (updated.count !== earnings.length)
    throw new ConflictError("Channel revenue settlement changed concurrently", undefined, {
      messageKey: "relay.revenueSettlementContended",
    });
  await tx.relayChannelProvider.update({ where: { id: providerId }, data: { lastSettledAt: new Date() } });
  return { id: settlement.id, amount };
}
