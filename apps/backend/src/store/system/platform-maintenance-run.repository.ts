import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { iamAccountDenied } from "../users/iam-account-principal";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import type {
  PlatformMaintenanceRunStore,
  MaintenanceRunTarget,
  MaintenanceRunFilters,
} from "./platform-maintenance-run.store";
import { isCanonicalMaintenanceRunId } from "@/iam/resources/platform-maintenance-resources";
export const MAINTENANCE_RUN_VIEW_SELECT = {
  id: true,
  status: true,
  createTime: true,
  updateTime: true,
  operation: true,
  dataset: true,
  tableNames: true,
  runStatus: true,
  startedByUserId: true,
  requestId: true,
  totalCount: true,
  insertedCount: true,
  skippedCount: true,
  invalidCount: true,
  failedCount: true,
  errorMessage: true,
  result: true,
  startedAt: true,
  completedAt: true,
} as const;
const metadata = {
  id: true,
  status: true,
  createTime: true,
  updateTime: true,
  operation: true,
  runStatus: true,
} as const;
export class PlatformMaintenanceRunRepository implements PlatformMaintenanceRunStore {
  private static instance: PlatformMaintenanceRunRepository;
  static getInstance() {
    return (this.instance ??= new PlatformMaintenanceRunRepository());
  }
  async assertActor(principal: IamPrincipal) {
    await platformManagementGroupSnapshot(principal, Permission.SYSTEM_DATA_MAINTENANCE_MANAGE);
  }
  private filter(filters: MaintenanceRunFilters): Prisma.DataMaintenanceRunWhereInput {
    return {
      status: 1,
      ...(filters.operation ? { operation: filters.operation } : {}),
      ...(filters.runStatus ? { runStatus: filters.runStatus } : {}),
    };
  }
  async scan(principal: IamPrincipal, filters: MaintenanceRunFilters, after?: string) {
    await this.assertActor(principal);
    if (after !== undefined && !isCanonicalMaintenanceRunId(after)) throw iamAccountDenied();
    return prisma.dataMaintenanceRun.findMany({
      where: { ...this.filter(filters), ...(after ? { id: { gt: after } } : {}) },
      select: metadata,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  private where(targets: readonly MaintenanceRunTarget[]): Prisma.DataMaintenanceRunWhereInput {
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => !isCanonicalMaintenanceRunId(t.id) || t.status !== 1)
    )
      throw iamAccountDenied();
    return {
      status: 1,
      OR: targets.map((t) => ({ id: t.id, updateTime: t.updateTime })),
    };
  }
  async hydrate(principal: IamPrincipal, targets: readonly MaintenanceRunTarget[]) {
    await this.assertActor(principal);
    if (!targets.length) return [];
    return prisma.dataMaintenanceRun.findMany({ where: this.where(targets), select: MAINTENANCE_RUN_VIEW_SELECT });
  }
  async target(principal: IamPrincipal, id: string) {
    await this.assertActor(principal);
    if (!isCanonicalMaintenanceRunId(id)) throw iamAccountDenied();
    return prisma.dataMaintenanceRun.findFirst({ where: { id, status: 1 }, select: metadata });
  }

  async recheck(principal: IamPrincipal, targets: readonly MaintenanceRunTarget[], filters?: MaintenanceRunFilters) {
    await this.assertActor(principal);
    if (!targets.length) return [];
    return prisma.dataMaintenanceRun.findMany({
      where: { AND: [this.where(targets), ...(filters ? [this.filter(filters)] : [])] },
      select: metadata,
    });
  }
}
