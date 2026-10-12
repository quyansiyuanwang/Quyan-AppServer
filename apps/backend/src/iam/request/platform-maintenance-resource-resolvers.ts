import { optimizePreviewBodySchema } from "@/api/schema/system/data-maintenance.schema";
import { isMaintenanceDataset, platformMaintenanceDatasetArn } from "../resources/platform-maintenance-resources";
import type { BatchResourceResolver, ResourceResolver } from "./resource-resolvers";
import { isCanonicalMaintenanceRunId, platformMaintenanceRunArn } from "../resources/platform-maintenance-resources";
export const platformMaintenanceRunResourceResolver: ResourceResolver = ({ request }) =>
  isCanonicalMaintenanceRunId(request.params.runId) ? platformMaintenanceRunArn(request.params.runId) : undefined;

export const platformMaintenanceDatasetResourceResolver: ResourceResolver = ({ request }) =>
  isMaintenanceDataset(request.params.dataset) ? platformMaintenanceDatasetArn(request.params.dataset) : undefined;
export const platformMaintenanceDatasetBatchResourceResolver: BatchResourceResolver = ({ request }) => {
  const result = optimizePreviewBodySchema.strict().safeParse(request.body);
  return result.success ? [...new Set(result.data.datasets)].map(platformMaintenanceDatasetArn) : undefined;
};
