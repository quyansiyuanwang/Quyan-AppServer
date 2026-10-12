import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { DATA_LIFECYCLE_DATASETS, type DataLifecycleDataset } from "@/constant/data-maintenance-datasets";

export function isLifecycleDataset(value: unknown): value is DataLifecycleDataset {
  return typeof value === "string" && (DATA_LIFECYCLE_DATASETS as readonly string[]).includes(value);
}
export function platformLifecycleDatasetArn(dataset: string) {
  if (!isLifecycleDataset(dataset)) throw new Error("Invalid lifecycle dataset identity");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "lifecycle-dataset/" + dataset,
  });
}
export function platformLifecycleScheduleArn() {
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "lifecycle-schedule/default",
  });
}
