import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { relayProviderArn, relayProviderEarningArn } from "@/iam/resources/relay-provider-resources";
import { balanceAccountArn } from "@/iam/resources/balance-resources";
import { assertIamAccountUserMutation, type IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { iamAccountDenied } from "../users/iam-account-principal";
import { settleProviderEarnings, type ProviderSettlementWriteGuard } from "./provider-earning-settlement";
import { ConflictError } from "@/util/errors";
import { lockBalanceAccount } from "../billing/balance-account-mutation";

export interface ProviderEarningsClaimGuard extends ProviderSettlementWriteGuard {
  users: IamAccountUserMutationGuard;
  authorize(resources: readonly string[]): Promise<void>;
}
export interface RelayProviderEarningsClaimStore {
  claim(guard: ProviderEarningsClaimGuard, dryRun?: boolean): Promise<{ settledAmount: number; settlementId?: string }>;
}
const claimPolicy = Object.freeze({ transactionTimeoutMs: 30000 });
export class RelayProviderEarningsClaimRepository implements RelayProviderEarningsClaimStore {
  private static instance: RelayProviderEarningsClaimRepository;
  static getInstance() {
    return (this.instance ??= new RelayProviderEarningsClaimRepository());
  }
  async claim(guard: ProviderEarningsClaimGuard, dryRun = false) {
    const { principal } = guard.users,
      userId = principal.subjectUserId,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    try {
      return await prisma.$transaction(
        async (tx) => {
          await assertIamAccountUserMutation(tx, guard.users, userId);
          const revision = await readIamAuthorizationRevision(tx, principal.accountOwnerId);
          // Lock the whole candidate range before computing or writing any settlement.
          await tx.$queryRaw`SELECT id FROM relay_channel_providers WHERE userId=${userId} ORDER BY id FOR UPDATE`;
          const providers = await tx.relayChannelProvider.findMany({
            where: { userId, status: 1, settlementMode: "manual" },
            orderBy: { id: "asc" },
            select: { id: true },
          });
          const candidates: { providerId: string; ids: string[]; amount: Prisma.Decimal }[] = [];
          const authorize = async (resources: readonly string[]) => {
            for (let offset = 0; offset < resources.length; offset += limit)
              await guard.authorize(resources.slice(offset, offset + limit));
          };
          await authorize([balanceAccountArn(principal.accountOwnerId, userId)]);
          for (const provider of providers) {
            await tx.$queryRaw`SELECT id FROM relay_channel_provider_earnings WHERE providerId=${provider.id} AND settlementId IS NULL ORDER BY id FOR UPDATE`;
            const earnings = await tx.relayChannelProviderEarning.findMany({
              where: { providerId: provider.id, settlementId: null, status: 1 },
              orderBy: { id: "asc" },
              select: { id: true, commissionAmount: true },
            });
            if (!earnings.length) continue;
            await authorize([
              relayProviderArn(principal.accountOwnerId, userId, provider.id),
              ...earnings.map((row) => relayProviderEarningArn(principal.accountOwnerId, userId, row.id)),
            ]);
            candidates.push({
              providerId: provider.id,
              ids: earnings.map((row) => row.id),
              amount: earnings.reduce((sum, row) => sum.add(row.commissionAmount), new Prisma.Decimal(0)),
            });
          }
          await guard.users.recheck();
          const before = !dryRun && candidates.length ? await lockBalanceAccount(tx, userId) : undefined;
          if (before && before.status !== 1) throw iamAccountDenied();
          let total = new Prisma.Decimal(0),
            settlementId: string | undefined;
          for (const candidate of candidates) {
            if (candidate.amount.lt(0) || !candidate.amount.isFinite()) throw iamAccountDenied();
            total = total.add(candidate.amount);
            if (dryRun) continue;
            const result = await settleProviderEarnings(tx, candidate.providerId, candidate.ids, "manual", guard);
            const settled = await tx.relayChannelProviderSettlement.findUnique({
              where: { id: result.id },
              select: { id: true, providerId: true, amount: true, settlementMode: true, balanceTransactionId: true },
            });
            if (
              !settled ||
              settled.providerId !== candidate.providerId ||
              !settled.amount.eq(candidate.amount) ||
              settled.settlementMode !== "manual" ||
              !settled.balanceTransactionId ||
              result.amount !== Number(candidate.amount)
            )
              throw iamAccountDenied();
            const ledger = await tx.balanceTransaction.findUnique({
              where: { id: settled.balanceTransactionId },
              select: {
                userId: true,
                type: true,
                amount: true,
                balanceBefore: true,
                balanceAfter: true,
                relatedId: true,
              },
            });
            if (
              !ledger ||
              ledger.userId !== userId ||
              ledger.type !== "channel_commission" ||
              ledger.relatedId !== settled.id ||
              !ledger.amount.eq(candidate.amount) ||
              !ledger.balanceAfter.sub(ledger.balanceBefore).eq(candidate.amount)
            )
              throw iamAccountDenied();
            const updated = await tx.relayChannelProviderEarning.count({
              where: {
                id: { in: candidate.ids },
                providerId: candidate.providerId,
                settlementId: result.id,
                status: 1,
                settledAt: { not: null },
              },
            });
            if (updated !== candidate.ids.length) throw iamAccountDenied();
            settlementId = result.id;
          }
          if (!dryRun && candidates.length) {
            const balance = await tx.balanceAccount.findUnique({
              where: { userId },
              select: { userId: true, status: true, balance: true, totalCommissionEarned: true },
            });
            if (
              !balance ||
              balance.status !== 1 ||
              !balance.balance.eq(new Prisma.Decimal(before?.balance ?? 0).add(total)) ||
              !balance.totalCommissionEarned.eq(new Prisma.Decimal(before?.totalCommissionEarned ?? 0).add(total))
            )
              throw iamAccountDenied();
          }
          await assertIamAccountUserMutation(tx, guard.users, userId);
          if ((await readIamAuthorizationRevision(tx, principal.accountOwnerId)) !== revision) throw iamAccountDenied();
          return { settledAmount: Number(total), ...(settlementId ? { settlementId } : {}) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: claimPolicy.transactionTimeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Provider earnings changed concurrently", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
