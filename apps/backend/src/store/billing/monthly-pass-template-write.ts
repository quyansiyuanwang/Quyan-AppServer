import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Permission, type IamMonthlyPassTemplateWriteOperation } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation, type IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { BadRequestError, ConflictError } from "@/util/errors";
import type { MonthlyPassTemplateWithQuotaWindows } from "./monthly-pass.store";
export interface MonthlyPassTemplateWriteGuard {
  operation: IamMonthlyPassTemplateWriteOperation;
  deleteViaUpdate: boolean;
  target?: { record: MonthlyPassTemplateWithQuotaWindows; revision: string };
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  recheckEntry: (id: string) => Promise<void>;
}
/** Include quota-window scalars and prices: a timestamp alone cannot detect stale configuration. */
export function monthlyPassTemplateRevision(row: MonthlyPassTemplateWithQuotaWindows) {
  const { quotaWindows, ...fields } = row;
  const scalars = (value: object) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256")
    .update(JSON.stringify([scalars(fields), [...quotaWindows].sort((a, b) => a.id.localeCompare(b.id)).map(scalars)]))
    .digest("hex");
}
async function identity(tx: Prisma.TransactionClient, guard: MonthlyPassTemplateWriteGuard) {
  if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
  await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
  await tx.$queryRaw`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`;
  const group = await platformManagementGroupSnapshot(
    guard.users.principal,
    Permission.MONTHLY_PASS_TEMPLATE_WRITE,
    tx,
  );
  if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
    throw iamAccountDenied();
}
export async function runMonthlyPassTemplateWrite<T extends { id: string }>(
  guard: MonthlyPassTemplateWriteGuard | undefined,
  id: string | undefined,
  data: Prisma.MonthlyPassTemplateUncheckedCreateInput | Prisma.MonthlyPassTemplateUncheckedUpdateInput,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  if (!guard) return prisma.$transaction(mutate);
  const create = guard.operation === "CreateTemplate";
  if (
    (create ? id !== undefined || !!guard.target : !isPlatformLogResourceId(id) || guard.target?.record.id !== id) ||
    data.id !== undefined ||
    data.createTime !== undefined ||
    data.updateTime !== undefined
  )
    throw iamAccountDenied();
  if (data.status !== undefined && (typeof data.status !== "number" || ![-1, 0, 1].includes(data.status)))
    throw iamAccountDenied();
  if (
    (create && (data.status !== 1 || data.publishStatus !== "draft")) ||
    (guard.operation === "UpdateTemplate" &&
      (data.publishStatus !== undefined ||
        data.publishedAt !== undefined ||
        (data.status === -1 && !guard.deleteViaUpdate))) ||
    (guard.operation === "DeleteTemplate" && data.status !== -1) ||
    (guard.operation === "PublishTemplate" &&
      (data.publishStatus !== "published" || !(data.publishedAt instanceof Date))) ||
    (guard.operation === "UnpublishTemplate" && (data.publishStatus !== "draft" || data.publishedAt !== null))
  )
    throw iamAccountDenied();
  if (!create && guard.operation !== "UpdateTemplate") {
    const keys = guard.operation === "DeleteTemplate" ? ["status"] : ["publishStatus", "publishedAt"];
    if (Object.keys(data).some((key) => !keys.includes(key))) throw iamAccountDenied();
  }
  try {
    return await prisma.$transaction(
      async (tx) => {
        await identity(tx, guard);
        const revision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
        if (!create) {
          await tx.$queryRaw`SELECT id FROM monthly_pass_templates WHERE id=${id} FOR UPDATE`;
          const current = await tx.monthlyPassTemplate.findUnique({ where: { id }, include: { quotaWindows: true } });
          if (
            !current ||
            current.id !== id ||
            ![0, 1].includes(current.status) ||
            monthlyPassTemplateRevision(current) !== guard.target!.revision ||
            monthlyPassTemplateRevision(guard.target!.record) !== guard.target!.revision
          )
            throw iamAccountDenied();
          if (guard.operation === "PublishTemplate" && current.status !== 1) throw iamAccountDenied();
          await guard.recheckEntry(id!);
        } else await guard.users.recheck();
        if (typeof data.name === "string") {
          await tx.$queryRaw`SELECT id FROM monthly_pass_templates WHERE name=${data.name} AND status>=0 FOR UPDATE`;
          if (
            await tx.monthlyPassTemplate.findFirst({
              where: { name: data.name, status: { gte: 0 }, ...(id ? { id: { not: id } } : {}) },
              select: { id: true },
            })
          )
            throw new BadRequestError("Template name already exists", undefined, {
              messageKey: "monthlyPass.templateNameExists",
            });
        }
        const result = await mutate(tx);
        if (!create && result.id !== id) throw iamAccountDenied();
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
      throw new ConflictError("Monthly pass template mutation source changed", undefined, {
        messageKey: "errors.conflict",
      });
    throw error;
  }
}
