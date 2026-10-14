import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { assertIamAccountUserMutation, type IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { iamAccountDenied } from "../users/iam-account-principal";
import { ConflictError } from "@/util/errors";
export type CarpoolOrderManagementTarget = Prisma.CarpoolOrderGetPayload<{ include: { members: true } }>;
export interface CarpoolOrderManagementWriteGuard {
  operation: "AcceptOrder";
  target: { record: CarpoolOrderManagementTarget; revision: string };
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export function carpoolOrderManagementRevision(row: CarpoolOrderManagementTarget) {
  const { members, ...fields } = row,
    scalars = (value: object) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256")
    .update(JSON.stringify([scalars(fields), [...members].sort((a, b) => a.id.localeCompare(b.id)).map(scalars)]))
    .digest("hex");
}
async function identity(tx: Prisma.TransactionClient, guard: CarpoolOrderManagementWriteGuard) {
  if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
  await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
  await tx.$queryRaw`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`;
  const group = await platformManagementGroupSnapshot(guard.users.principal, Permission.CARPOOL_ORDER_FULFILL, tx);
  if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
    throw iamAccountDenied();
}
export async function runCarpoolOrderManagementWrite<T>(
  guard: CarpoolOrderManagementWriteGuard,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  const id = guard.target.record.id;
  if (
    guard.operation !== "AcceptOrder" ||
    carpoolOrderManagementRevision(guard.target.record) !== guard.target.revision
  )
    throw iamAccountDenied();
  try {
    return await prisma.$transaction(
      async (tx) => {
        await identity(tx, guard);
        const revision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
        await tx.$queryRaw`SELECT id FROM carpool_orders WHERE id=${id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM carpool_members WHERE orderId=${id} ORDER BY id FOR UPDATE`;
        const current = await tx.carpoolOrder.findUnique({ where: { id }, include: { members: true } });
        if (
          !current ||
          ![0, 1].includes(current.status) ||
          carpoolOrderManagementRevision(current) !== guard.target.revision
        )
          throw iamAccountDenied();
        const result = await mutate(tx);
        const after = await tx.carpoolOrder.findUnique({ where: { id }, include: { members: true } });
        if (
          !after ||
          after.state !== "accepted" ||
          !(after.acceptedAt instanceof Date) ||
          !result ||
          typeof result !== "object" ||
          Reflect.get(result, "id") !== id ||
          carpoolOrderManagementRevision({
            ...after,
            state: current.state,
            acceptedAt: current.acceptedAt,
            updateTime: current.updateTime,
          }) !== guard.target.revision
        )
          throw iamAccountDenied();
        await identity(tx, guard);
        if ((await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== revision)
          throw iamAccountDenied();
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
      throw new ConflictError("Carpool order source changed", undefined, { messageKey: "errors.conflict" });
    throw error;
  }
}
