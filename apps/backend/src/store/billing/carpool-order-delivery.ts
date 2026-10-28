import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { iamAccountDenied } from "../users/iam-account-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import {
  assertCarpoolOrderManagementIdentity,
  carpoolOrderManagementRevision,
  type CarpoolOrderManagementWriteGuard,
} from "./carpool-order-management-write";
import {
  CARPOOL_REFUND_CUSTOMER_SELECT,
  carpoolRefundCustomerRevision,
  type CarpoolRefundCustomer,
} from "./carpool-order-refund";
import { ConflictError } from "@/util/errors";
export interface CarpoolOrderDeliveryGuard
  extends Pick<CarpoolOrderManagementWriteGuard, "group" | "users" | "target"> {
  channelId: string;
  templateId: string;
  customers: CarpoolRefundCustomer[];
  deliveries: { userId: string; passId: string; tokenId: string }[];
  checkDelivery: (userId: string, passId: string, tokenId: string) => Promise<void>;
}
export async function runCarpoolOrderDelivery<T>(
  guard: CarpoolOrderDeliveryGuard,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  const id = guard.target.record.id,
    members = guard.target.record.members.filter((row) => row.state !== "left"),
    userIds = members.map((row) => row.userId);
  if (
    guard.deliveries.length ||
    userIds.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
    new Set(userIds).size !== userIds.length ||
    carpoolOrderManagementRevision(guard.target.record) !== guard.target.revision ||
    guard.customers.length !== userIds.length ||
    userIds.some((userId) => !guard.customers.some((row) => row.id === userId)) ||
    members.some((row) => row.userMonthlyPassId || row.state === "delivered")
  )
    throw iamAccountDenied();
  try {
    return await prisma.$transaction(
      async (tx) => {
        await assertCarpoolOrderManagementIdentity(tx, guard);
        const revision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
        await tx.$queryRaw`SELECT id FROM carpool_orders WHERE id=${id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM carpool_members WHERE orderId=${id} ORDER BY id FOR UPDATE`;
        const source = await tx.carpoolOrder.findUnique({ where: { id }, include: { members: true } });
        if (
          !source ||
          ![0, 1].includes(source.status) ||
          carpoolOrderManagementRevision(source) !== guard.target.revision
        )
          throw iamAccountDenied();
        await tx.$queryRaw`SELECT id FROM carpool_package_templates WHERE id=${source.packageTemplateId} FOR UPDATE`;
        const packageSource = await tx.carpoolPackageTemplate.findUnique({
          where: { id: source.packageTemplateId },
          select: { monthlyPassTemplateId: true },
        });
        if (
          !packageSource ||
          (source.monthlyPassTemplateId ?? packageSource.monthlyPassTemplateId) !== guard.templateId
        )
          throw iamAccountDenied();
        await tx.$queryRaw`SELECT id FROM monthly_pass_templates WHERE id=${guard.templateId} FOR UPDATE`;
        if (!(await tx.monthlyPassTemplate.findUnique({ where: { id: guard.templateId }, select: { id: true } })))
          throw iamAccountDenied();
        await tx.$queryRaw`SELECT id FROM relay_channels WHERE id=${guard.channelId} FOR UPDATE`;
        const channel = await tx.relayChannel.findFirst({
          where: { id: guard.channelId, status: 1, providerServiceEnabled: true, submissionStatus: "approved" },
          select: { id: true },
        });
        if (!channel) throw iamAccountDenied();
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
        const result = await mutate(tx),
          after = await tx.carpoolOrder.findUnique({ where: { id }, include: { members: true } });
        if (
          !after ||
          after.state !== "fulfilled" ||
          after.relayChannelId !== guard.channelId ||
          !(after.fulfilledAt instanceof Date) ||
          !result ||
          typeof result !== "object" ||
          Reflect.get(result, "id") !== id ||
          guard.deliveries.length !== members.length ||
          new Set(guard.deliveries.map((row) => row.passId)).size !== members.length ||
          new Set(guard.deliveries.map((row) => row.tokenId)).size !== members.length
        )
          throw iamAccountDenied();
        const normalized = {
          ...after,
          state: source.state,
          relayChannelId: source.relayChannelId,
          fulfilledAt: source.fulfilledAt,
          updateTime: source.updateTime,
          members: after.members.map((row) => {
            const old = members.find((member) => member.id === row.id);
            if (!old) return row;
            const delivery = guard.deliveries.find((entry) => entry.userId === old.userId);
            if (!delivery || row.state !== "delivered" || row.userMonthlyPassId !== delivery.passId)
              throw iamAccountDenied();
            return { ...row, state: old.state, userMonthlyPassId: old.userMonthlyPassId, updateTime: old.updateTime };
          }),
        };
        if (carpoolOrderManagementRevision(normalized) !== guard.target.revision) throw iamAccountDenied();
        for (const member of members) {
          const entry = guard.deliveries.find((row) => row.userId === member.userId)!;
          const pass = await tx.userMonthlyPass.findUnique({ where: { id: entry.passId } });
          const token = await tx.relayToken.findUnique({
            where: { id: entry.tokenId },
            select: {
              id: true,
              userId: true,
              carpoolMemberId: true,
              channelId: true,
              quotaLimit: true,
              allowedModels: true,
              status: true,
              usedQuota: true,
            },
          });
          if (
            !pass ||
            pass.userId !== member.userId ||
            pass.templateId !== guard.templateId ||
            pass.status !== 1 ||
            !pass.totalQuota.equals(member.finalQuota) ||
            !pass.remainingQuota.equals(member.finalQuota) ||
            !pass.usedQuota.equals(0) ||
            pass.quotaUnit !== source.quotaUnit ||
            pass.quotaWindowHours !== source.quotaWindowHours ||
            pass.startAt.getTime() !== after.fulfilledAt.getTime() ||
            pass.endAt.getTime() - pass.startAt.getTime() !== source.validityDays * 86400000 ||
            !token ||
            token.userId !== member.userId ||
            token.carpoolMemberId !== member.id ||
            token.channelId !== guard.channelId ||
            token.status !== 1 ||
            !token.usedQuota.equals(0) ||
            !token.quotaLimit?.equals(member.finalQuota.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)) ||
            token.allowedModels !== source.allowedModels
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
      throw new ConflictError("Carpool delivery source changed", undefined, { messageKey: "errors.conflict" });
    throw error;
  }
}
