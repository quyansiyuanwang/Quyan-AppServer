import { DATA_MAINTENANCE_DATASETS, type DataMaintenanceDataset } from "@/constant/data-maintenance-datasets";
import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isCanonicalMaintenanceRunId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
}
export function platformMaintenanceRunArn(id: string) {
  if (!isCanonicalMaintenanceRunId(id)) throw new Error("Invalid maintenance run identity");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "maintenance-run/" + id,
  });
}

export function platformMaintenanceDatasetArn(dataset: string) {
  if (!isMaintenanceDataset(dataset)) throw new Error("Invalid maintenance dataset identity");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "maintenance-dataset/" + dataset,
  });
}

export function isMaintenanceDataset(value: unknown): value is DataMaintenanceDataset {
  return typeof value === "string" && (DATA_MAINTENANCE_DATASETS as readonly string[]).includes(value);
}
