import { env } from "@/config/env";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { DATA_MAINTENANCE_TABLES } from "@/constant/data-maintenance-datasets";
import { isMaintenanceDataset } from "@/iam/resources/platform-maintenance-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { MAINTENANCE_RUN_VIEW_SELECT } from "./platform-maintenance-run.repository";
import { ConflictError } from "@/util/errors";
import type {
  MaintenanceImportGuard,
  MaintenanceImportInput,
  PlatformMaintenanceImportStore,
} from "./platform-maintenance-import.store";
export class PlatformMaintenanceImportRepository implements PlatformMaintenanceImportStore {
  private static instance: PlatformMaintenanceImportRepository;
  static getInstance() {
    return (this.instance ??= new PlatformMaintenanceImportRepository());
  }
  private async identity(tx: Prisma.TransactionClient, guard: MaintenanceImportGuard) {
    if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const current = await platformManagementGroupSnapshot(
      guard.users.principal,
      Permission.SYSTEM_DATA_MAINTENANCE_MANAGE,
      tx,
    );
    if (current.id !== guard.group.id || current.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  async create(guard: MaintenanceImportGuard, input: MaintenanceImportInput, requestId?: string) {
    const datasets = [...guard.datasets];
    const count = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
    const prefix = env.integrations.objectStorage.staging.prefix + "/maintenance/import/";
    if (
      guard.action !== "quyan:system:data_maintenance:CreateImportRun" ||
      datasets.length !== 1 ||
      !isMaintenanceDataset(datasets[0]) ||
      Object.keys(input).some((k) => !["objectKey", "totalCount", "invalidCount", "duplicateCount"].includes(k)) ||
      typeof input.objectKey !== "string" ||
      input.objectKey.length > 512 ||
      !input.objectKey.startsWith(prefix) ||
      !/^\d{4}-\d{2}-\d{2}\/\d+-[a-f0-9]{64}\.ndjson\.gz$/.test(input.objectKey.slice(prefix.length)) ||
      ![input.totalCount, input.invalidCount, input.duplicateCount].every(count) ||
      input.invalidCount !== 0 ||
      input.duplicateCount > input.totalCount ||
      (requestId !== undefined && (typeof requestId !== "string" || requestId.length > 128))
    )
      throw iamAccountDenied();

    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          const run = await tx.dataMaintenanceRun.create({
            data: {
              operation: "import",
              dataset: datasets[0],
              status: 1,
              runStatus: "queued",
              tableNames: datasets.map((d) => DATA_MAINTENANCE_TABLES[d]),
              startedByUserId: guard.users.principal.subjectUserId,
              requestId,
              tempObjectKey: input.objectKey,
              totalCount: input.totalCount,
              invalidCount: input.invalidCount,
              result: { duplicateCount: input.duplicateCount },
            },
            select: MAINTENANCE_RUN_VIEW_SELECT,
          });
          await this.identity(tx, guard);
          return run;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Maintenance authorization changed during task creation", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}
