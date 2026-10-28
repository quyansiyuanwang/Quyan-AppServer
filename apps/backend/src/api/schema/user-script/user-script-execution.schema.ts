import { z } from "zod";

export const createExecutionBodySchema = z.object({
  scriptId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
  scriptName: z.string().trim().min(1).max(100),
  contentSnapshot: z.string().min(1),
  output: z.string(),
  durationMs: z.number().int().min(0),
});

export const executionScriptIdParamsSchema = z.object({
  scriptId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});
