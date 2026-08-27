import { z } from "zod";

export const contentSafetyRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["literal", "regex"]),
  pattern: z.string().trim().min(2).max(2000),
  direction: z.enum(["request", "response", "both"]),
  action: z.enum(["unreachable", "blackhole", "allow"]),
  enabled: z.coerce.boolean().optional(),
  priority: z.coerce.number().int().min(0).max(100000).optional(),
  targetUserId: z.string().trim().min(1).optional(),
});

export const contentSafetyConfigSchema = z.object({
  requestEnabled: z.coerce.boolean(),
  requestAction: z.enum(["unreachable", "blackhole", "allow"]),
  requestAiEnabled: z.coerce.boolean(),
  requestAiAction: z.enum(["unreachable", "blackhole", "allow"]).optional(),
  responseEnabled: z.coerce.boolean(),
  responseAction: z.enum(["unreachable", "blackhole", "allow"]),
  responseAiEnabled: z.coerce.boolean(),
  responseAiAction: z.enum(["unreachable", "blackhole", "allow"]).optional(),
  aiUpstreamUrl: z.string().max(500),
  aiApiKey: z.string().max(1000).optional(),
  clearAiApiKey: z.coerce.boolean().optional(),
  aiModel: z.string().max(160),
  aiRequestFormat: z.enum(["openai-chat-completions", "anthropic", "gemini"]),
  aiTimeoutMs: z.coerce.number().int().min(1000).max(30000),
  aiInputPricePerMillion: z.coerce.number().min(0).max(100000),
  aiOutputPricePerMillion: z.coerce.number().min(0).max(100000),
  aiMaxTextLength: z.coerce.number().int().min(1000).max(100000),
});

export const contentSafetyCsvImportSchema = z.object({
  csv: z
    .string()
    .min(1)
    .max(1024 * 1024),
  mode: z.enum(["preview", "apply"]).optional(),
  overwrite: z.coerce.boolean().optional(),
  targetUserId: z.string().trim().min(1).optional(),
});

export const contentSafetyBatchUpdateSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(500),
  changes: z
    .object({
      enabled: z.boolean().optional(),
      action: z.enum(["unreachable", "blackhole", "allow"]).optional(),
      direction: z.enum(["request", "response", "both"]).optional(),
      priority: z.number().int().min(0).max(100000).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "At least one change is required"),
  targetUserId: z.string().trim().min(1).optional(),
});

export const contentSafetyExportSchema = z.object({
  format: z.enum(["json", "csv"]).optional(),
  targetUserId: z.string().trim().min(1).optional(),
});

export const contentSafetyUserConfigSchema = z.object({
  requestEnabled: z.boolean().nullable(),
  requestAction: z.enum(["unreachable", "blackhole", "allow"]).nullable(),
  requestAiEnabled: z.boolean().nullable(),
  requestAiAction: z.enum(["unreachable", "blackhole", "allow"]).nullable(),
  responseEnabled: z.boolean().nullable(),
  responseAction: z.enum(["unreachable", "blackhole", "allow"]).nullable(),
  responseAiEnabled: z.boolean().nullable(),
  responseAiAction: z.enum(["unreachable", "blackhole", "allow"]).nullable(),
  targetUserId: z.string().trim().min(1).optional(),
});

export const contentSafetyRuleOverrideSchema = z.object({
  ruleId: z.string().trim().min(1),
  enabled: z.boolean(),
  targetUserId: z.string().trim().min(1).optional(),
});
