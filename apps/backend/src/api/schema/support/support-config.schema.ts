import { z } from "zod";
import { RELAY_PROBE_FORMATS } from "@quyan/shared";
export const updateSupportConfigSchema = z
  .object({
    enabled: z.boolean(),
    upstreamUrl: z.string().trim(),
    apiKey: z.string().optional(),
    clearApiKey: z.boolean().optional(),
    model: z.string().trim(),
    requestFormat: z.enum(RELAY_PROBE_FORMATS),
    systemPrompt: z.string().optional(),
    maxRequests: z.number().int().positive(),
    windowSeconds: z.number().int().positive(),
    maxAgentRounds: z.number().int().optional(),
    maxOutputTokens: z.number().int().optional(),
    allowUserBalance: z.boolean().optional(),
    allowUserRelayToken: z.boolean().optional(),
    sessionRetentionDays: z.number().int().optional(),
    inputPricePerMillion: z.number().nonnegative().optional(),
    outputPricePerMillion: z.number().nonnegative().optional(),
  })
  .strict();
