import type { IamPrincipal } from "@quyan/shared";
import type { DataMaintenanceRun } from "@prisma/client";
export type MaintenanceRunTarget = Pick<
  DataMaintenanceRun,
  "id" | "status" | "createTime" | "updateTime" | "operation" | "runStatus"
>;
export type MaintenanceRunView = Omit<DataMaintenanceRun, "tempObjectKey">;
export interface MaintenanceRunFilters {
  page: number;
  pageSize: number;
  operation?: string;
  runStatus?: string;
}
export interface PlatformMaintenanceRunStore {
  assertActor(principal: IamPrincipal): Promise<void>;
  scan(principal: IamPrincipal, filters: MaintenanceRunFilters, after?: string): Promise<MaintenanceRunTarget[]>;
  target(principal: IamPrincipal, id: string): Promise<MaintenanceRunTarget | null>;
  hydrate(principal: IamPrincipal, targets: readonly MaintenanceRunTarget[]): Promise<MaintenanceRunView[]>;
  recheck(
    principal: IamPrincipal,
    targets: readonly MaintenanceRunTarget[],
    filters?: MaintenanceRunFilters,
  ): Promise<MaintenanceRunTarget[]>;
}
