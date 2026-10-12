export const DATA_LIFECYCLE_DATASETS = [
  "api_logs",
  "business_logs",
  "notification_logs",
  "track_events",
  "heatmap_points",
  "ai_request_logs",
  "relay_usages",
  "monthly_pass_usages",
  "server_logs",
] as const;

export type DataLifecycleDataset = (typeof DATA_LIFECYCLE_DATASETS)[number];

export const DATA_MAINTENANCE_DATASETS = DATA_LIFECYCLE_DATASETS.filter(
  (dataset): dataset is Exclude<DataLifecycleDataset, "server_logs" | "ai_request_logs"> =>
    dataset !== "server_logs" && dataset !== "ai_request_logs",
) as readonly Exclude<DataLifecycleDataset, "server_logs" | "ai_request_logs">[];
export type DataMaintenanceDataset = (typeof DATA_MAINTENANCE_DATASETS)[number];
