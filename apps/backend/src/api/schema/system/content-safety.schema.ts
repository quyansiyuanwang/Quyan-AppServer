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
  responseEnabled: z.coerce.boolean(),
  responseAction: z.enum(["unreachable", "blackhole", "allow"]),
  responseAiEnabled: z.coerce.boolean(),
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
  targetUserId: z.string().trim().min(1).optional(),
});

export const contentSafetyUserConfigSchema = z.object({
  requestEnabled: z.boolean().nullable(),
  requestAction: z.enum(["unreachable", "blackhole", "allow"]).nullable(),
  requestAiEnabled: z.boolean().nullable(),
  responseEnabled: z.boolean().nullable(),
  responseAction: z.enum(["unreachable", "blackhole", "allow"]).nullable(),
  responseAiEnabled: z.boolean().nullable(),
  targetUserId: z.string().trim().min(1).optional(),
});

export const contentSafetyRuleOverrideSchema = z.object({
  ruleId: z.string().trim().min(1),
  enabled: z.boolean(),
  targetUserId: z.string().trim().min(1).optional(),
});
