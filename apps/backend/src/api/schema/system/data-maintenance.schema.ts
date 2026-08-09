import { z } from "zod";
import { DATA_MAINTENANCE_DATASETS } from "@/store/system/observability.repository";

const dataset = z.enum(DATA_MAINTENANCE_DATASETS as [string, ...string[]]);

export const maintenanceRunParamsSchema = z.object({ runId: z.string().trim().min(1).max(191) });
export const optimizeBodySchema = z.object({
  datasets: z.array(dataset).min(1).max(DATA_MAINTENANCE_DATASETS.length),
  confirmation: z.literal("OPTIMIZE"),
  captchaToken: z.string().trim().max(4096).optional(),
});
export const optimizePreviewBodySchema = z.object({
  datasets: z.array(dataset).min(1).max(DATA_MAINTENANCE_DATASETS.length),
  captchaToken: z.string().trim().max(4096).optional(),
});
export const importPreviewQuerySchema = z.object({ dataset });
export const importQuerySchema = importPreviewQuerySchema;
export const maintenanceRunsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  operation: z.enum(["optimize", "import"]).optional(),
  runStatus: z.enum(["queued", "running", "completed", "failed", "cancelled"]).optional(),
});
