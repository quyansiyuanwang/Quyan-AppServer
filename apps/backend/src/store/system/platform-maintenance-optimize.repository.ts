import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { DATA_MAINTENANCE_DATASETS, DATA_MAINTENANCE_TABLES } from "@/constant/data-maintenance-datasets";
import { isMaintenanceDataset } from "@/iam/resources/platform-maintenance-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { MAINTENANCE_RUN_VIEW_SELECT } from "./platform-maintenance-run.repository";
import { ConflictError } from "@/util/errors";
import type {
  MaintenanceOptimizeGuard,
  MaintenanceOptimizeInput,
  PlatformMaintenanceOptimizeStore,
} from "./platform-maintenance-optimize.store";
export class PlatformMaintenanceOptimizeRepository implements PlatformMaintenanceOptimizeStore {
  private static instance: PlatformMaintenanceOptimizeRepository;
  static getInstance() {
    return (this.instance ??= new PlatformMaintenanceOptimizeRepository());
  }
  private async identity(tx: Prisma.TransactionClient, guard: MaintenanceOptimizeGuard) {
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
  async create(guard: MaintenanceOptimizeGuard, input: MaintenanceOptimizeInput, requestId?: string) {
    const datasets = [...guard.datasets];
    const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
    if (
      guard.action !== "quyan:system:data_maintenance:CreateOptimizeRun" ||
      !datasets.length ||
      datasets.length > DATA_MAINTENANCE_DATASETS.length ||
      new Set(datasets).size !== datasets.length ||
      datasets.some((d) => !isMaintenanceDataset(d)) ||
      Object.keys(input).some((k) => !["items", "totalRows", "totalBytes"].includes(k)) ||
      !count(input.totalRows) ||
      input.totalRows > 2147483647 ||
      !Array.isArray(input.items) ||
      input.items.length !== datasets.length ||
      new Set(input.items.map((i) => i.dataset)).size !== datasets.length ||
      input.items.some(
        (i) =>
          !isMaintenanceDataset(i.dataset) ||
          !datasets.includes(i.dataset) ||
          i.tableName !== DATA_MAINTENANCE_TABLES[i.dataset] ||
          i.executable !== true ||
          ![i.rowCount, i.dataBytes, i.indexBytes].every(count) ||
          Object.keys(i).some(
            (k) => !["dataset", "tableName", "rowCount", "dataBytes", "indexBytes", "executable"].includes(k),
          ),
      ) ||
      input.items.reduce((sum, i) => sum + i.rowCount, 0) !== input.totalRows ||
      (requestId !== undefined && (typeof requestId !== "string" || requestId.length > 128))
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          const run = await tx.dataMaintenanceRun.create({
            data: {
              operation: "optimize",
              dataset: null,
              status: 1,
              runStatus: "queued",
              tableNames: datasets.map((d) => DATA_MAINTENANCE_TABLES[d]),
              startedByUserId: guard.users.principal.subjectUserId,
              requestId,
              totalCount: input.totalRows,
              result: input.items,
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
