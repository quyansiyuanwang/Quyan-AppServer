import { createHash } from "node:crypto";
import type { RelayChannel, RelayChannelProbeProfile } from "@prisma/client";
import type { RelayProbeFormat } from "@quyan/shared";
import type { RelayChannelProbeEndpoint } from "@/api/dto/relay/relay-channel-probe.dto";
import type { ModelPricingItemDto } from "@/api/dto/relay/relay-config.dto";
import type { TimePeriodMultiplierRule } from "@/api/dto/relay/relay-channel.dto";
import { resolveMappedModel } from "@/util/model-mapping.util";
import { resolveModelId } from "@/util/model-resolution.util";
import { BadRequestError } from "@/util/errors";
import { computeMultiplierForTime } from "./time-period-multiplier.service";
import { RELAY_PROBE_APPLY_POLICY } from "@/constant/relay-probe";

export function defaultProbeEndpoint(format: RelayProbeFormat): RelayChannelProbeEndpoint {
  return format === "openai-responses"
    ? "openai-responses"
    : format === "openai" || format === "openai-chat-completions"
      ? "openai-chat-completions"
      : format === "anthropic"
        ? "anthropic-messages"
        : format === "gemini"
          ? "gemini-generate-content"
          : "openai-chat-completions";
}

export function requiresLargeMultiplierConfirmation(
  sourceMultiplier: number,
  targetMultiplier: number,
  previousSuggestedMultiplier?: number,
): boolean {
  if (
    Math.abs(targetMultiplier - sourceMultiplier) / Math.max(sourceMultiplier, Number.EPSILON) <=
    RELAY_PROBE_APPLY_POLICY.largeChangeRatio
  )
    return false;
  return (
    previousSuggestedMultiplier == null ||
    Math.abs(previousSuggestedMultiplier - targetMultiplier) / Math.max(targetMultiplier, Number.EPSILON) > 0.1
  );
}

/**
 * Probe traffic must resolve models in the same way as relay traffic: the
 * configured model name selects local pricing, while its modelId is what the
 * upstream receives. This matters for channel-level aliases and mappings.
 */
export function resolveProbeModelPricing(
  probeModel: string,
  channelModelMapping: Record<string, string> | null | undefined,
  modelRates: ModelPricingItemDto[],
): { rate: ModelPricingItemDto; upstreamModelId: string } {
  const pricingModel = resolveMappedModel(probeModel.trim(), channelModelMapping);
  const rate = modelRates.find((item) => item.model === pricingModel);
  if (!rate)
    throw new BadRequestError("探针模型没有本地定价配置", undefined, {
      messageKey: "relayChannelProbe.modelNoLocalPricing",
    });
  const upstreamModelId = rate.modelId?.trim() || resolveModelId(rate).trim();
  if (!upstreamModelId)
    throw new BadRequestError("探针模型缺少上游模型标识", undefined, {
      messageKey: "relayChannelProbe.modelMissingUpstreamId",
    });
  return { rate, upstreamModelId };
}

export type ProbePricingProfile = Pick<RelayChannelProbeProfile, "probeModel" | "probeEndpoint" | "cacheMode">;
export type ProbeBillingChannel = Pick<
  RelayChannel,
  "timePeriodMultipliers" | "contextLengthMultipliers" | "inputTokensIncludeCacheRead"
>;
/** One snapshot contract for workers, legacy application and resource-authorized application. No secrets. */
export function buildProbePricingSnapshot(
  profile: ProbePricingProfile,
  channel: ProbeBillingChannel,
  modelMapping: RelayChannel["modelMapping"],
  rate: ModelPricingItemDto,
  globalMultiplier: number,
  now = new Date(),
): Record<string, unknown> {
  return {
    model: profile.probeModel,
    modelMapping: modelMapping ?? {},
    rate,
    globalMultiplier,
    timeMultiplier: computeMultiplierForTime(
      (channel.timePeriodMultipliers as TimePeriodMultiplierRule[] | null) || [],
      now,
    ),
    timePeriodMultipliers: channel.timePeriodMultipliers ?? [],
    contextLengthMultipliers: channel.contextLengthMultipliers ?? [],
    inputTokensIncludeCacheRead: channel.inputTokensIncludeCacheRead === true,
    cacheMode: profile.cacheMode,
    endpoint: profile.probeEndpoint,
  };
}
export function fingerprintProbePricing(snapshot: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
