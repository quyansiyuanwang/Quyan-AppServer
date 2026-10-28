import { createHash } from "node:crypto";
import { Prisma, type CarpoolPackageTemplate, type MonthlyPassTemplate } from "@prisma/client";
import { Permission, type IamCarpoolTemplateWriteOperation } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation, type IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { ConflictError } from "@/util/errors";
export interface CarpoolTemplateWriteGuard {
  operation: IamCarpoolTemplateWriteOperation;
  target?: { record: CarpoolPackageTemplate; revision: string };
  monthlySource?: { record: MonthlyPassTemplate; revision: string };
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  recheckEntry: (id: string) => Promise<void>;
  payloadRevision?: string;
}
/** Include all persisted scalar values so unchanged timestamps cannot hide a changed source. */
export function carpoolTemplateRevision(row: object) {
  return createHash("sha256")
    .update(JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))
    .digest("hex");
}
export function bindCarpoolTemplateWrite(guard: CarpoolTemplateWriteGuard, data: object) {
  if (guard.payloadRevision) throw iamAccountDenied();
  guard.payloadRevision = carpoolTemplateRevision(data);
}
async function identity(tx: Prisma.TransactionClient, guard: CarpoolTemplateWriteGuard) {
  if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
  await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
  await tx.$queryRaw`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`;
  const group = await platformManagementGroupSnapshot(guard.users.principal, Permission.CARPOOL_TEMPLATE_WRITE, tx);
  if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
    throw iamAccountDenied();
}
export async function runCarpoolTemplateWrite<T extends { id: string }>(
  guard: CarpoolTemplateWriteGuard | undefined,
  id: string | undefined,
  data: Prisma.CarpoolPackageTemplateUncheckedCreateInput | Prisma.CarpoolPackageTemplateUncheckedUpdateInput,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  if (!guard) return prisma.$transaction(mutate);
  const create = ["CreateTemplate", "DuplicateTemplate"].includes(guard.operation),
    sourceId = guard.target?.record.id;
  if (
    !guard.payloadRevision ||
    guard.payloadRevision !== carpoolTemplateRevision(data) ||
    (create ? id !== undefined : !isPlatformLogResourceId(id) || id !== sourceId) ||
    (guard.operation === "CreateTemplate" ? !!guard.target : !isPlatformLogResourceId(sourceId)) ||
    ["id", "createTime", "updateTime", "orders", "monthlyPassTemplate"].some((key) => Object.hasOwn(data, key))
  )
    throw iamAccountDenied();
  if (
    (create && (data.status !== 1 || data.publishStatus !== "draft" || data.publishedAt !== null)) ||
    (guard.operation === "UpdateTemplate" &&
      ["status", "publishStatus", "publishedAt"].some((key) => Object.hasOwn(data, key))) ||
    (guard.operation === "ArchiveTemplate" &&
      (data.status !== -1 || data.publishStatus !== "draft" || data.publishedAt !== null)) ||
    (guard.operation === "PublishTemplate" &&
      (data.publishStatus !== "published" || !(data.publishedAt instanceof Date))) ||
    (guard.operation === "UnpublishTemplate" && (data.publishStatus !== "draft" || data.publishedAt !== null))
  )
    throw iamAccountDenied();
  if (
    ["ArchiveTemplate", "PublishTemplate", "UnpublishTemplate"].includes(guard.operation) &&
    Object.keys(data).some((key) => !["status", "publishStatus", "publishedAt"].includes(key))
  )
    throw iamAccountDenied();
  if (
    ["CreateTemplate", "UpdateTemplate"].includes(guard.operation) !== !!guard.monthlySource ||
    (guard.monthlySource && data.monthlyPassTemplateId !== guard.monthlySource.record.id)
  )
    throw iamAccountDenied();
  try {
    return await prisma.$transaction(
      async (tx) => {
        await identity(tx, guard);
        const revision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
        if (guard.target) {
          await tx.$queryRaw`SELECT id FROM carpool_package_templates WHERE id=${sourceId} FOR UPDATE`;
          const current = await tx.carpoolPackageTemplate.findUnique({ where: { id: sourceId } });
          if (
            !current ||
            ![0, 1].includes(current.status) ||
            carpoolTemplateRevision(current) !== guard.target.revision ||
            carpoolTemplateRevision(guard.target.record) !== guard.target.revision
          )
            throw iamAccountDenied();
          if (guard.operation === "PublishTemplate" && current.status !== 1) throw iamAccountDenied();
          if (guard.operation === "DuplicateTemplate") {
            // Copies preserve the authorized source snapshot rather than importing newer upstream terms.
            for (const [key, value] of Object.entries(current)) {
              if (["id", "name", "status", "publishStatus", "publishedAt", "createTime", "updateTime"].includes(key))
                continue;
              if (JSON.stringify(Reflect.get(data, key)) !== JSON.stringify(value)) throw iamAccountDenied();
            }
          }
        }
        if (guard.monthlySource) {
          const source = guard.monthlySource;
          await tx.$queryRaw`SELECT id FROM monthly_pass_templates WHERE id=${source.record.id} FOR UPDATE`;
          const current = await tx.monthlyPassTemplate.findUnique({ where: { id: source.record.id } });
          if (
            !current ||
            current.status !== 1 ||
            carpoolTemplateRevision(current) !== source.revision ||
            carpoolTemplateRevision(source.record) !== source.revision
          )
            throw iamAccountDenied();
          const snapshots = {
            snapshotQuota: current.defaultQuota,
            snapshotValidityDays: current.validityDays,
            snapshotQuotaUnit: current.quotaUnit,
            snapshotQuotaWindowHours: current.quotaWindowHours,
            snapshotAllowedModels: current.allowedModels,
            snapshotAllowedChannels: current.allowedChannels,
          };
          for (const [key, value] of Object.entries(snapshots))
            if (JSON.stringify(Reflect.get(data, key)) !== JSON.stringify(value)) throw iamAccountDenied();
        }
        await guard.users.recheck();
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
      throw new ConflictError("Carpool template mutation source changed", undefined, { messageKey: "errors.conflict" });
    throw error;
  }
}
