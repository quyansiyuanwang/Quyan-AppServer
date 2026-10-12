import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { DataMaintenanceDataset } from "@/constant/data-maintenance-datasets";
import type { MaintenanceRunView } from "./platform-maintenance-run.store";
export interface MaintenanceImportGuard {
  action: "quyan:system:data_maintenance:CreateImportRun";
  datasets: readonly DataMaintenanceDataset[];
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export interface MaintenanceImportInput {
  objectKey: string;
  totalCount: number;
  invalidCount: number;
  duplicateCount: number;
}
export interface PlatformMaintenanceImportStore {
  create(guard: MaintenanceImportGuard, input: MaintenanceImportInput, requestId?: string): Promise<MaintenanceRunView>;
}
