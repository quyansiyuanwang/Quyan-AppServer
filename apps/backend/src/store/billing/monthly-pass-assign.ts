import { Prisma, type User } from "@prisma/client";
import { createHash } from "node:crypto";
import { Permission, IAM_MONTHLY_PASS_ASSIGN_OPERATIONS, type IamMonthlyPassAssignOperation } from "@quyan/shared";
import { prisma } from "@/config/database";
import { assertIamAccountUserMutation, type IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { iamAccountDenied } from "../users/iam-account-principal";
import { monthlyPassTemplateRevision } from "./monthly-pass-template-write";
import { ConflictError } from "@/util/errors";
import type { MonthlyPassTemplateWithQuotaWindows } from "./monthly-pass.store";
export const MONTHLY_PASS_ASSIGNMENT_USER_SELECT = {
  id: true,
  status: true,
  accountOwnerId: true,
  updateTime: true,
} as const;
export type MonthlyPassAssignmentUser = Pick<User, "id" | "status" | "accountOwnerId" | "updateTime">;
export const monthlyPassAssignmentUserRevision = (row: MonthlyPassAssignmentUser) =>
  createHash("sha256")
    .update(JSON.stringify([row.id, row.status, row.accountOwnerId, row.updateTime.toISOString()]))
    .digest("hex");
export interface MonthlyPassAssignGuard {
  operation: IamMonthlyPassAssignOperation;
  customer: MonthlyPassAssignmentUser;
  template: MonthlyPassTemplateWithQuotaWindows;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  recheckEntry: (id: string) => Promise<void>;
}
async function identity(tx: Prisma.TransactionClient, guard: MonthlyPassAssignGuard) {
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
export async function runMonthlyPassAssignmentCreate<T extends { id: string }>(
  guard: MonthlyPassAssignGuard | undefined,
  data: Prisma.UserMonthlyPassUncheckedCreateInput,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  if (!guard) return prisma.$transaction(mutate);
  if (
    !IAM_MONTHLY_PASS_ASSIGN_OPERATIONS.some((entry) => entry.operation === guard.operation) ||
    data.userId !== guard.customer.id ||
    data.templateId !== guard.template.id ||
    data.assignedBy !== guard.users.principal.subjectUserId ||
    data.status !== 1 ||
    Number(data.usedQuota) !== 0 ||
    !Number.isFinite(Number(data.totalQuota)) ||
    Number(data.totalQuota) <= 0 ||
    Number(data.remainingQuota) !== Number(data.totalQuota) ||
    ["id", "createTime", "updateTime", "quotaWindows"].some((key) => Object.hasOwn(data, key))
  )
    throw iamAccountDenied();
  try {
    return await prisma.$transaction(
      async (tx) => {
        await identity(tx, guard);
        const revision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
        await assertMonthlyPassAssignmentSources(tx, guard);
        const result = await mutate(tx);
        await identity(tx, guard);
        await guard.recheckEntry(result.id);
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

/** Lock and compare every source used to derive a creation or batch extension. */
export async function assertMonthlyPassAssignmentSources(tx: Prisma.TransactionClient, guard: MonthlyPassAssignGuard) {
  await identity(tx, guard);
  await tx.$queryRaw`SELECT id FROM users WHERE id=${guard.customer.id} FOR UPDATE`;
  const user = await tx.user.findUnique({
    where: { id: guard.customer.id },
    select: MONTHLY_PASS_ASSIGNMENT_USER_SELECT,
  });
  if (
    !user ||
    ![0, 1].includes(user.status) ||
    monthlyPassAssignmentUserRevision(user) !== monthlyPassAssignmentUserRevision(guard.customer)
  )
    throw iamAccountDenied();
  await tx.$queryRaw`SELECT id FROM monthly_pass_templates WHERE id=${guard.template.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM monthly_pass_template_quota_windows WHERE monthlyPassTemplateId=${guard.template.id} ORDER BY id FOR UPDATE`;
  const template = await tx.monthlyPassTemplate.findUnique({
    where: { id: guard.template.id },
    include: { quotaWindows: true },
  });
  if (
    !template ||
    template.status !== 1 ||
    monthlyPassTemplateRevision(template) !== monthlyPassTemplateRevision(guard.template)
  )
    throw iamAccountDenied();
}
