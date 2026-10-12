import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { DataMaintenanceDataset } from "@/constant/data-maintenance-datasets";
import type { MaintenanceRunView } from "./platform-maintenance-run.store";
export interface MaintenanceOptimizeGuard {
  action: "quyan:system:data_maintenance:CreateOptimizeRun";
  datasets: readonly DataMaintenanceDataset[];
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export interface MaintenanceOptimizeInput {
  totalRows: number;
  items: {
    dataset: string;
    tableName: string;
    rowCount: number;
    dataBytes: number;
    indexBytes: number;
    executable: boolean;
  }[];
}
export interface PlatformMaintenanceOptimizeStore {
  create(
    guard: MaintenanceOptimizeGuard,
    input: MaintenanceOptimizeInput,
    requestId?: string,
  ): Promise<MaintenanceRunView>;
}
