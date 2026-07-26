import { z } from "zod";

const variablePathSchema = z.string().trim().min(1).max(200);
const credentialMapSchema = z.record(z.string().trim().min(1).max(80), z.string().min(1).max(2000));

const workflowStepSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_]{0,49}$/),
  method: z.enum(["GET", "POST"]),
  url: z.string().trim().url().max(1000),
  headers: z.record(z.string().trim().min(1).max(100), z.string().max(4000)).optional(),
  query: z.record(z.string().trim().min(1).max(100), z.string().max(4000)).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
  extract: z
    .record(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z][A-Za-z0-9_]{0,49}$/),
      variablePathSchema,
    )
    .optional(),
  balancePath: variablePathSchema.optional(),
});

export const relayChannelProbeChannelParamsSchema = z.object({ channelId: z.string().trim().min(1) });
export const relayChannelProbeRunParamsSchema = z.object({ runId: z.string().trim().min(1) });
export const relayChannelProbeRunsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export const clearRelayChannelProbeRunHistoryQuerySchema = z.object({
  scope: z.enum(["all", "failed"]),
});
export const upsertRelayChannelProbeProfileBodySchema = z
  .object({
    enabled: z.boolean(),
    probeFormat: z.enum(["openai", "anthropic", "gemini"]),
    probeModel: z.string().trim().min(1).max(200),
    probePayload: z.record(z.string(), z.unknown()),
    upstreamCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3,12}$/)
      .optional(),
    localCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3,12}$/)
      .optional(),
    upstreamBalanceDivisor: z.coerce.number().finite().min(0.000001).max(1_000_000_000).optional(),
    probeGroup: z.string().trim().max(80).optional(),
    distributionMultiplier: z.coerce.number().min(0.000001).max(1000).optional(),
    workflow: z.array(workflowStepSchema).min(1).max(3),
    credentials: credentialMapSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.workflow.filter((step) => step.balancePath).length !== 1)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workflow"], message: "Exactly one balancePath is required" });
  });
export const createRelayChannelProbeRunBodySchema = z.object({
  distributionMultiplier: z.coerce.number().min(0.000001).max(1000).optional(),
});
export const createRelayChannelProbeRunsBodySchema = z.object({
  channelIds: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
  distributionMultiplier: z.coerce.number().min(0.000001).max(1000).optional(),
});
export const applyRelayChannelProbeRunsBodySchema = z.object({
  runIds: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
  overrides: z
    .array(
      z.object({
        runId: z.string().trim().min(1),
        multiplier: z.coerce.number().finite().min(0.000001).max(1000),
      }),
    )
    .max(100)
    .optional(),
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const [index, override] of (value.overrides || []).entries()) {
    if (!value.runIds.includes(override.runId))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["overrides", index, "runId"], message: "Unknown runId" });
    if (seen.has(override.runId))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["overrides", index, "runId"], message: "Duplicate runId" });
    seen.add(override.runId);
  }
});
