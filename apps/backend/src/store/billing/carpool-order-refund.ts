import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { iamAccountDenied } from "../users/iam-account-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import {
  assertCarpoolOrderManagementIdentity,
  type CarpoolOrderManagementWriteGuard,
} from "./carpool-order-management-write";
import { lockBalanceAccounts } from "./balance-account-mutation";
import { ConflictError } from "@/util/errors";
export const CARPOOL_REFUND_SOURCE_INCLUDE = { members: { include: { reservation: true } } } as const;
export const CARPOOL_REFUND_CUSTOMER_SELECT = {
  id: true,
  status: true,
  accountOwnerId: true,
  updateTime: true,
} as const;
export type CarpoolRefundTarget = Prisma.CarpoolOrderGetPayload<{ include: typeof CARPOOL_REFUND_SOURCE_INCLUDE }>;
export type CarpoolRefundCustomer = Prisma.UserGetPayload<{ select: typeof CARPOOL_REFUND_CUSTOMER_SELECT }>;
export interface CarpoolOrderRefundGuard extends Pick<CarpoolOrderManagementWriteGuard, "group" | "users"> {
  target: { record: CarpoolRefundTarget; revision: string };
  customers: CarpoolRefundCustomer[];
  reason: string;
  ledgers: { userId: string; id: string }[];
  checkLedger: (userId: string, id: string) => Promise<void>;
}
const scalars = (value: object) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
export function carpoolRefundRevision(row: CarpoolRefundTarget) {
  const { members, ...fields } = row;
  return createHash("sha256")
    .update(
      JSON.stringify([
        scalars(fields),
        [...members]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(({ reservation, ...member }) => [scalars(member), reservation ? scalars(reservation) : null]),
      ]),
    )
    .digest("hex");
}
export function carpoolRefundCustomerRevision(row: CarpoolRefundCustomer) {
  return createHash("sha256")
    .update(JSON.stringify(scalars(row)))
    .digest("hex");
}
export async function runCarpoolOrderRefund<T>(
  guard: CarpoolOrderRefundGuard,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  const id = guard.target.record.id,
    members = guard.target.record.members.filter((row) => row.state !== "left"),
    userIds = members.map((row) => row.userId);
  if (
    guard.ledgers.length ||
    userIds.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
    new Set(userIds).size !== userIds.length ||
    carpoolRefundRevision(guard.target.record) !== guard.target.revision ||
    guard.customers.length !== userIds.length ||
    userIds.some((userId) => !guard.customers.some((row) => row.id === userId)) ||
    members.some(
      (row) =>
        row.reservation &&
        (row.reservation.userId !== row.userId ||
          row.reservation.orderId !== id ||
          row.reservation.memberId !== row.id ||
          row.reservation.amount.lt(0)),
    )
  )
    throw iamAccountDenied();
  try {
    return await prisma.$transaction(
      async (tx) => {
        await assertCarpoolOrderManagementIdentity(tx, guard);
        const revision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
        await tx.$queryRaw`SELECT id FROM carpool_orders WHERE id=${id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM carpool_members WHERE orderId=${id} ORDER BY id FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM balance_reservations WHERE orderId=${id} ORDER BY id FOR UPDATE`;
        const source = await tx.carpoolOrder.findUnique({ where: { id }, include: CARPOOL_REFUND_SOURCE_INCLUDE });
        if (!source || ![0, 1].includes(source.status) || carpoolRefundRevision(source) !== guard.target.revision)
          throw iamAccountDenied();
        if (userIds.length)
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join([...userIds].sort())}) ORDER BY id FOR UPDATE`,
          );
        const customers = await tx.user.findMany({
          where: { id: { in: userIds } },
          select: CARPOOL_REFUND_CUSTOMER_SELECT,
        });
        if (
          customers.length !== guard.customers.length ||
          customers.some(
            (row) =>
              ![0, 1].includes(row.status) ||
              !guard.customers.some(
                (old) => old.id === row.id && carpoolRefundCustomerRevision(old) === carpoolRefundCustomerRevision(row),
              ),
          )
        )
          throw iamAccountDenied();
        const accounts = await lockBalanceAccounts(
            tx,
            userIds.map((userId) => ({ userId, createIfMissing: true })),
          ),
          initialLedgerCount = await tx.balanceTransaction.count({ where: { relatedId: id, type: "carpool_refund" } });
        const result = await mutate(tx),
          after = await tx.carpoolOrder.findUnique({ where: { id }, include: CARPOOL_REFUND_SOURCE_INCLUDE });
        const refunded = members.filter((row) => row.reservation?.state === "captured");
        if (
          !after ||
          after.state !== "failed" ||
          after.failureReason !== guard.reason ||
          !(after.failedAt instanceof Date) ||
          !result ||
          typeof result !== "object" ||
          Reflect.get(result, "id") !== id ||
          guard.ledgers.length !== refunded.length ||
          new Set(guard.ledgers.map((row) => row.id)).size !== refunded.length ||
          (await tx.balanceTransaction.count({ where: { relatedId: id, type: "carpool_refund" } })) !==
            initialLedgerCount + refunded.length
        )
          throw iamAccountDenied();
        const normalized = {
          ...after,
          state: source.state,
          failedAt: source.failedAt,
          failureReason: source.failureReason,
          updateTime: source.updateTime,
          members: after.members.map((row) => {
            const old = refunded.find((member) => member.id === row.id)?.reservation;
            if (!old) return row;
            if (!row.reservation || row.reservation.state !== "refunded") throw iamAccountDenied();
            return { ...row, reservation: { ...row.reservation, state: old.state, updateTime: old.updateTime } };
          }),
        };
        if (carpoolRefundRevision(normalized) !== guard.target.revision) throw iamAccountDenied();
        for (const customer of guard.customers) {
          const amount =
              refunded.find((row) => row.userId === customer.id)?.reservation?.amount ?? new Prisma.Decimal(0),
            before = accounts.get(customer.id),
            account = await tx.balanceAccount.findUnique({ where: { userId: customer.id } });
          if (
            !before ||
            !account ||
            !account.balance.equals(before.balance.plus(amount)) ||
            !account.totalUsed.equals(before.totalUsed.minus(amount)) ||
            !account.totalRecharged.equals(before.totalRecharged) ||
            !account.totalCommissionEarned.equals(before.totalCommissionEarned) ||
            account.status !== before.status
          )
            throw iamAccountDenied();
        }
        for (const member of refunded) {
          const entries = guard.ledgers.filter((entry) => entry.userId === member.userId);
          if (entries.length !== 1) throw iamAccountDenied();
          const ledger = await tx.balanceTransaction.findUnique({ where: { id: entries[0]!.id } });
          const before = accounts.get(member.userId)!;
          if (
            !ledger ||
            ledger.userId !== member.userId ||
            ledger.relatedId !== id ||
            ledger.type !== "carpool_refund" ||
            !ledger.amount.equals(member.reservation!.amount) ||
            !ledger.balanceBefore.equals(before.balance) ||
            !ledger.balanceAfter.equals(before.balance.plus(member.reservation!.amount))
          )
            throw iamAccountDenied();
        }
        await assertCarpoolOrderManagementIdentity(tx, guard);
        if ((await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== revision)
          throw iamAccountDenied();
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
      throw new ConflictError("Carpool refund source changed", undefined, { messageKey: "errors.conflict" });
    throw error;
  }
}
