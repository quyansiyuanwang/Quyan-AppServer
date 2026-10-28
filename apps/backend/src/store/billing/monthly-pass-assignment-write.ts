import { createHash } from "node:crypto";
import { Prisma, type UserMonthlyPass, type UserMonthlyPassQuotaWindow } from "@prisma/client";
import { Permission, type IamMonthlyPassAssignmentWriteOperation } from "@quyan/shared";
import { prisma } from "@/config/database";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation, type IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { ConflictError } from "@/util/errors";
import { assertMonthlyPassAssignmentSources, type MonthlyPassAssignGuard } from "./monthly-pass-assign";
import type { UserMonthlyPassWithTemplate } from "./monthly-pass.store";
export interface MonthlyPassAssignmentWriteGuard {
  operation: IamMonthlyPassAssignmentWriteOperation | "AssignUserPassBatch";
  batchSources?: MonthlyPassAssignGuard;
  deleteViaUpdate: boolean;
  target: { record: UserMonthlyPassWithTemplate; revision: string };
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  response: { username: boolean; template: boolean };
}
/** Exclude related display content; include every assignment scalar and ordered quota window. */
export function monthlyPassAssignmentRevision(
  row: UserMonthlyPass & { quotaWindows: UserMonthlyPassQuotaWindow[]; template?: unknown; user?: unknown },
) {
  const { quotaWindows, template: _template, user: _user, ...fields } = row;
  const scalars = (value: object) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256")
    .update(JSON.stringify([scalars(fields), [...quotaWindows].sort((a, b) => a.id.localeCompare(b.id)).map(scalars)]))
    .digest("hex");
}
async function identity(tx: Prisma.TransactionClient, guard: MonthlyPassAssignmentWriteGuard) {
  if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
  await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
  await tx.$queryRaw`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`;
  const group = await platformManagementGroupSnapshot(
    guard.users.principal,
    Permission.MONTHLY_PASS_ASSIGNMENT_WRITE,
    tx,
  );
  if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
    throw iamAccountDenied();
}
export async function runMonthlyPassAssignmentWrite<T extends { id: string }>(
  guard: MonthlyPassAssignmentWriteGuard | undefined,
  id: string,
  data: Prisma.UserMonthlyPassUncheckedUpdateInput,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  if (!guard) return prisma.$transaction(mutate);
  if (
    (guard.operation === "AssignUserPassBatch" &&
      (!guard.batchSources ||
        guard.batchSources.operation !== "AssignUserPassBatch" ||
        guard.batchSources.customer.id !== guard.target.record.userId ||
        guard.batchSources.template.id !== guard.target.record.templateId ||
        Object.keys(data).some(
          (key) =>
            !["endAt", "totalQuota", "dailyQuota", "quotaUnit", "quotaWindowHours", "remainingQuota", "note"].includes(
              key,
            ),
        ))) ||
    (guard.operation !== "AssignUserPassBatch" && guard.batchSources !== undefined) ||
    guard.target.record.id !== id ||
    monthlyPassAssignmentRevision(guard.target.record) !== guard.target.revision ||
    ["id", "userId", "templateId", "assignedBy", "createTime", "updateTime", "usedQuota"].some((key) =>
      Object.hasOwn(data, key),
    ) ||
    (data.status !== undefined && (typeof data.status !== "number" || ![-1, 0, 1].includes(data.status))) ||
    (guard.operation === "UpdateUserPass" && data.status === -1 && !guard.deleteViaUpdate) ||
    (guard.operation === "DeleteUserPass" && (data.status !== -1 || Object.keys(data).some((key) => key !== "status")))
  )
    throw iamAccountDenied();
  try {
    return await prisma.$transaction(
      async (tx) => {
        await identity(tx, guard);
        const revision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
        if (guard.batchSources) {
          await assertMonthlyPassAssignmentSources(tx, guard.batchSources);
          const latest = await tx.userMonthlyPass.findFirst({
            where: {
              userId: guard.batchSources.customer.id,
              templateId: guard.batchSources.template.id,
              status: { gte: 0 },
            },
            orderBy: [{ endAt: "desc" }, { createTime: "desc" }, { id: "desc" }],
            select: { id: true },
          });
          if (latest?.id !== id) throw iamAccountDenied();
        }
        await tx.$queryRaw`SELECT id FROM user_monthly_passes WHERE id=${id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM user_monthly_pass_quota_windows WHERE userMonthlyPassId=${id} ORDER BY id FOR UPDATE`;
        const current = await tx.userMonthlyPass.findUnique({ where: { id }, include: { quotaWindows: true } });
        if (
          !current ||
          current.id !== id ||
          ![0, 1].includes(current.status) ||
          current.userId !== guard.target.record.userId ||
          monthlyPassAssignmentRevision(current) !== guard.target.revision
        )
          throw iamAccountDenied();
        const result = await mutate(tx);
        if (result.id !== id) throw iamAccountDenied();
        await identity(tx, guard);
        if ((await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== revision)
          throw iamAccountDenied();
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
      throw new ConflictError("Monthly pass assignment source changed", undefined, { messageKey: "errors.conflict" });
    throw error;
  }
}
