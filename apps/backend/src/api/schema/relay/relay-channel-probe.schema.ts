import { z } from "zod";
import { RELAY_PROBE_FORMATS } from "@appserver/shared";

const variablePathSchema = z.string().trim().min(1).max(200);
const credentialMapSchema = z.record(z.string().trim().min(1).max(80), z.string().min(1).max(2000));
const memberCredentialMapSchema = z
  .record(z.string().trim().min(1).max(100), credentialMapSchema)
  .refine((value) => Object.keys(value).length <= 200, "Too many member credential entries");
const probeTargetSchema = z.object({
  channelId: z.string().trim().min(1),
  memberChannelId: z.string().trim().min(1).optional(),
});
const probeEndpointSchema = z.enum([
  "openai-chat-completions",
  "openai-responses",
  "anthropic-messages",
  "gemini-generate-content",
]);
const probeCacheModeSchema = z.enum(["cache-bust", "allow-cache", "warm-and-read"]);
const hasPersistedBalanceTolerancePrecision = (value: number): boolean => {
  const scaled = value * 1_000_000;
  return Math.abs(Math.round(scaled) - scaled) < 1e-8;
};

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
  memberChannelId: z.string().trim().min(1).optional(),
});
export const clearRelayChannelProbeRunHistoryQuerySchema = z.object({
  scope: z.enum(["all", "failed"]),
  memberChannelId: z.string().trim().min(1).optional(),
});
export const relayChannelProbeMemberBodySchema = z.object({
  memberChannelId: z.string().trim().min(1).optional(),
});
export const upsertRelayChannelProbeProfileBodySchema = z
  .object({
    enabled: z.boolean(),
    probeFormat: z.enum(RELAY_PROBE_FORMATS),
    probeEndpoint: probeEndpointSchema.optional(),
    probeModel: z.string().trim().min(1).max(200),
    probePayload: z.record(z.string(), z.unknown()),
    preventCache: z.boolean().optional(),
    cacheMode: probeCacheModeSchema.optional(),
    sampleCount: z.coerce.number().int().min(1).max(10).optional(),
    strictCalibrationValidation: z.boolean().optional(),
    measurementInputTokens: z.coerce.number().int().min(0).max(32_768).optional(),
    balanceSettlementTolerance: z.coerce
      .number()
      .finite()
      .min(0.000001)
      .max(1_000_000)
      .refine(hasPersistedBalanceTolerancePrecision, "balanceSettlementTolerance must have at most 6 decimal places")
      .optional(),
    balanceSettlementReads: z.coerce.number().int().min(2).max(5).optional(),
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
    upstreamRateMultiplier: z.coerce.number().finite().min(0.000001).max(1000).optional(),
    probeGroup: z.string().trim().max(80).optional(),
    distributionMultiplier: z.coerce.number().min(0.000001).max(1000).optional(),
    workflow: z.array(workflowStepSchema).min(1).max(3),
    credentials: credentialMapSchema.optional(),
    memberCredentials: memberCredentialMapSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.workflow.filter((step) => step.balancePath).length !== 1)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workflow"], message: "Exactly one balancePath is required" });
    const endpoint = value.probeEndpoint;
    if (
      endpoint &&
      ((endpoint === "openai-chat-completions" && !["openai", "openai-chat-completions"].includes(value.probeFormat)) ||
        (endpoint === "openai-responses" && value.probeFormat !== "openai-responses") ||
        (endpoint === "anthropic-messages" && value.probeFormat !== "anthropic") ||
        (endpoint === "gemini-generate-content" && value.probeFormat !== "gemini"))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["probeEndpoint"],
        message: "Probe endpoint is incompatible with probe format",
      });
  });
export const createRelayChannelProbeRunBodySchema = z.object({
  memberChannelId: z.string().trim().min(1).optional(),
  distributionMultiplier: z.coerce.number().min(0.000001).max(1000).optional(),
  forceWithoutCacheBuster: z.boolean().optional(),
});
export const createRelayChannelProbeRunsBodySchema = z
  .object({
    channelIds: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    targets: z
      .array(probeTargetSchema)
      .min(1)
      .max(200)
      .refine(
        (targets) =>
          new Set(targets.map((target) => `${target.channelId}:${target.memberChannelId || ""}`)).size === targets.length,
      )
      .optional(),
    distributionMultiplier: z.coerce.number().min(0.000001).max(1000).optional(),
    forceWithoutCacheBuster: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.channelIds?.length || value.targets?.length), {
    message: "At least one channelId or target is required",
  });
export const copyRelayChannelProbeProfileBodySchema = z
  .object({
    sourceChannelId: z.string().trim().min(1),
    targetChannelIds: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    overwriteExisting: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.targetChannelIds.includes(value.sourceChannelId))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetChannelIds"],
        message: "Source channel cannot also be a target",
      });
  });
export const applyRelayChannelProbeRunsBodySchema = z
  .object({
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
    forceLargeChange: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, override] of (value.overrides || []).entries()) {
      if (!value.runIds.includes(override.runId))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["overrides", index, "runId"], message: "Unknown runId" });
      if (seen.has(override.runId))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["overrides", index, "runId"], message: "Duplicate runId" });
      seen.add(override.runId);
    }
  });
