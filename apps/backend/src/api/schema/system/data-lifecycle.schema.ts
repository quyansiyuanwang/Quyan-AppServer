import { z } from "zod";
import { DATA_LIFECYCLE_DATASETS } from "@/store/system/observability.repository";

const dataset = z.enum(DATA_LIFECYCLE_DATASETS);

export const lifecycleDatasetParamsSchema = z.object({ dataset });
export const lifecycleArtifactParamsSchema = z.object({ artifactId: z.string().trim().min(1).max(191) });
export const lifecycleRunParamsSchema = z.object({ runId: z.string().trim().min(1).max(191) });
export const updateLifecyclePolicyBodySchema = z.object({
  enabled: z.boolean(),
  hotRetentionDays: z.number().int().min(1).max(3650),
});
export const lifecycleRunsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export const lifecycleArtifactsQuerySchema = lifecycleRunsQuerySchema;
