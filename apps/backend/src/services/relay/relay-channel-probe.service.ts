import axios from "axios";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import type { Prisma, RelayChannel } from "@prisma/client";
import { env } from "@/config/env";
import { assertSafeOutboundUrl } from "@/util/developer-outbound-url";
import { BadRequestError, ConflictError, LockBackendUnavailableError, NotFoundError } from "@/util/errors";
import { resolveMappedModel } from "@/util/model-mapping.util";
import { resolveModelId } from "@/util/model-resolution.util";
import { RelayChannelService } from "./relay-channel.service";
import { RelayConfigService } from "./relay-config.service";
import { computeMultiplierForTime } from "./time-period-multiplier.service";
import { resolveContextLengthMultiplier, type ContextLengthMultiplierRule } from "./context-length-multiplier.service";
import { RelayChannelProbeLockService } from "./relay-channel-probe-lock.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import logger from "@/util/logger";
import {
  RelayChannelProbeRepository,
  type RelayChannelProbeProfileRecord,
  type RelayChannelProbeRunRecord,
} from "@/store/relay/relay-channel-probe.repository";
import {
  DEFAULT_CACHE_CREATION_MULTIPLIER,
  DEFAULT_CACHE_READ_MULTIPLIER,
  TOKEN_PRICE_DIVISOR,
} from "@/constant/pricing";
import { extractTokenUsageMetrics, hasTokenValue, normalizeTokenBreakdown } from "@/util/token-usage.util";
import { parseRelayRequestFormats, supportsRelayRequestFormat, type RelayRequestFormat } from "@appserver/shared";
import type {
  ApplyRelayChannelProbeRunsRequest,
  ApplyRelayChannelProbeRunsResponse,
  CopyRelayChannelProbeProfileRequest,
  CopyRelayChannelProbeProfileResponse,
  CreateRelayChannelProbeRunRequest,
  CreateRelayChannelProbeRunsRequest,
  CreateRelayChannelProbeRunsResponse,
  ClearRelayChannelProbeRunHistoryResponse,
  RelayChannelProbeOverviewItemDto,
  RelayChannelProbeCustomerFacingTargetDto,
  RelayChannelProbeProfileDto,
  RelayChannelProbeRunDto,
  RelayChannelProbeRunHistoryScope,
  RelayChannelProbeWorkflowStepDto,
  RelayChannelProbeCostBreakdownDto,
  RelayChannelProbeEndpoint,
  RelayChannelProbeCacheMode,
  RelayChannelProbeCalibrationStatus,
  RelayChannelProbeSampleDto,
  UpsertRelayChannelProbeProfileRequest,
} from "@/api/dto/relay/relay-channel-probe.dto";
import type { RelayChannelDto, RelayChannelMemberDto, RelayChannelType } from "@/api/dto/relay/relay-channel.dto";
import type { ModelPricingItemDto } from "@/api/dto/relay/relay-config.dto";

// Upstream authentication, balance ledgers, and low-priority probe requests
// can legitimately be slow. This is a per-request timeout, not a retry delay.
const PROBE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const PROBE_LOCK_ACQUIRE_TIMEOUT_MS = 5 * 60 * 1000;
const RUN_LEASE_MS = 6 * 60 * 1000;
const SUGGESTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const RUN_QUEUE_SLOT_TTL_MS = 2 * 60 * 60 * 1000;
const RUN_QUEUE_SLOT_PREFIX = "relay:channel-probe-run:v1";
const GROUP_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CONCURRENT_PROBE_RUNS = 4;
// Upstream billing ledgers are commonly eventually consistent. Keep both
// snapshots outside the actual model request by a small, deterministic window
// while the channel write lock is held, so an in-app request cannot distort a
// calibration run between its two balance reads.
const PROBE_BEFORE_REQUEST_SETTLEMENT_DELAY_MS = 1_000;
const PROBE_BALANCE_SETTLEMENT_POLL_MS = 2_000;
const PROBE_BALANCE_SETTLEMENT_TIMEOUT_MS = 30_000;
const MIN_VERIFIED_SAMPLE_COUNT = 3;
const MAX_ACCEPTED_SAMPLE_SPREAD = 0.2;
const LARGE_MULTIPLIER_CHANGE_RATIO = 0.2;

export function requiresLargeMultiplierConfirmation(
  sourceMultiplier: number,
  targetMultiplier: number,
  previousSuggestedMultiplier?: number,
): boolean {
  if (
    Math.abs(targetMultiplier - sourceMultiplier) / Math.max(sourceMultiplier, Number.EPSILON) <=
    LARGE_MULTIPLIER_CHANGE_RATIO
  )
    return false;
  return (
    previousSuggestedMultiplier == null ||
    Math.abs(previousSuggestedMultiplier - targetMultiplier) / Math.max(targetMultiplier, Number.EPSILON) > 0.1
  );
}

type ProbeProfileRecord = RelayChannelProbeProfileRecord;
type ProbeRunRecord = RelayChannelProbeRunRecord;
export type RelayChannelProbeTopologyItem = Pick<
  RelayChannelDto,
  "id" | "name" | "enabled" | "channelType" | "poolMembers"
>;

type ProbeFormat = "openai" | "anthropic" | "gemini";
type ProbeBalanceSnapshot = { balance: number; observedAt: string };

/** Keep probe format availability aligned with the channel request-format contract. */
export function resolveAllowedProbeFormats(value: string | null | undefined): ProbeFormat[] {
  return parseRelayRequestFormats(value) as ProbeFormat[];
}

const isProbeableChannelType = (channelType: RelayChannelType | undefined): boolean =>
  channelType === "standalone" || channelType === "pooled";

export function defaultProbeEndpoint(format: ProbeFormat): RelayChannelProbeEndpoint {
  return format === "anthropic"
    ? "anthropic-messages"
    : format === "gemini"
      ? "gemini-generate-content"
      : "openai-chat-completions";
}

export function assertProbeEndpointCompatibility(endpoint: RelayChannelProbeEndpoint, format: ProbeFormat): void {
  const compatible = isProbeEndpointCompatible(endpoint, format);
  if (!compatible) throw new BadRequestError("探针接口与请求格式不兼容");
}

export function isProbeEndpointCompatible(endpoint: RelayChannelProbeEndpoint, format: ProbeFormat): boolean {
  return (
    (endpoint.startsWith("openai-") && format === "openai") ||
    (endpoint === "anthropic-messages" && format === "anthropic") ||
    (endpoint === "gemini-generate-content" && format === "gemini")
  );
}

export function normalizeProbeEndpoint(
  endpoint: string | null | undefined,
  format: ProbeFormat,
): RelayChannelProbeEndpoint {
  const candidate = endpoint as RelayChannelProbeEndpoint;
  return isProbeEndpointCompatible(candidate, format) ? candidate : defaultProbeEndpoint(format);
}

/** Minimal billable request body used when an older profile has no request payload yet. */
export function createDefaultProbePayload(
  format: ProbeFormat,
  endpoint: RelayChannelProbeEndpoint = defaultProbeEndpoint(format),
): Record<string, unknown> {
  const prompt = "Reply with OK.";
  if (endpoint === "openai-responses") {
    return {
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      max_output_tokens: 1,
    };
  }
  if (format === "anthropic") {
    return { max_tokens: 1, messages: [{ role: "user", content: prompt }] };
  }
  if (format === "gemini") {
    return { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1 } };
  }
  return { messages: [{ role: "user", content: prompt }], max_tokens: 1 };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Adds a unique probe marker where each supported upstream format treats it as
 * a highest-priority instruction. The caller owns the original JSON payload.
 */
export function injectProbeCacheBuster(
  sourcePayload: Record<string, unknown>,
  format: ProbeFormat,
  cacheBusterId: string,
  endpoint: RelayChannelProbeEndpoint = defaultProbeEndpoint(format),
): Record<string, unknown> | undefined {
  const payload = structuredClone(sourcePayload);
  const marker = `[probe-cache-buster:${cacheBusterId}]`;

  if (endpoint === "openai-responses") {
    if (typeof payload.input === "string") {
      payload.input = `${marker}\n${payload.input}`;
      return payload;
    }
    if (!Array.isArray(payload.input)) return undefined;
    payload.input = [{ role: "developer", content: [{ type: "input_text", text: marker }] }, ...payload.input];
    return payload;
  }

  if (format === "openai") {
    if (!Array.isArray(payload.messages)) return undefined;
    payload.messages = [{ role: "system", content: marker }, ...payload.messages];
    return payload;
  }

  if (format === "anthropic") {
    if (payload.system == null) {
      payload.system = marker;
      return payload;
    }
    if (typeof payload.system === "string") {
      payload.system = `${marker}\n${payload.system}`;
      return payload;
    }
    if (Array.isArray(payload.system)) {
      payload.system = [{ type: "text", text: marker }, ...payload.system];
      return payload;
    }
    return undefined;
  }

  if (payload.systemInstruction == null) {
    payload.systemInstruction = { parts: [{ text: marker }] };
    return payload;
  }
  if (!isRecord(payload.systemInstruction) || !Array.isArray(payload.systemInstruction.parts)) return undefined;
  payload.systemInstruction = {
    ...payload.systemInstruction,
    parts: [{ text: marker }, ...payload.systemInstruction.parts],
  };
  return payload;
}

/**
 * Adds deterministic, inert text to an existing user prompt so a balance
 * ledger with coarse precision can observe a real charge. It only changes a
 * supported text field and returns undefined for opaque custom payloads.
 */
export function injectProbeMeasurementInput(
  sourcePayload: Record<string, unknown>,
  format: ProbeFormat,
  measurementInputTokens: number,
  endpoint: RelayChannelProbeEndpoint = defaultProbeEndpoint(format),
): Record<string, unknown> | undefined {
  if (measurementInputTokens <= 0) return structuredClone(sourcePayload);
  const payload = structuredClone(sourcePayload);
  const padding = `\n[probe-measurement]\n${"calibration ".repeat(Math.ceil((measurementInputTokens * 4) / 12))}`;
  const appendContent = (content: unknown): unknown | undefined => {
    if (typeof content === "string") return `${content}${padding}`;
    if (!Array.isArray(content)) return undefined;
    const index = content.findIndex(
      (part) => isRecord(part) && typeof part.text === "string" && ["text", "input_text"].includes(String(part.type)),
    );
    if (index < 0) return undefined;
    return content.map((part, itemIndex) =>
      itemIndex === index
        ? { ...(part as Record<string, unknown>), text: `${String((part as Record<string, unknown>).text)}${padding}` }
        : part,
    );
  };
  const appendToMessages = (key: "messages" | "input"): boolean => {
    const messages = payload[key];
    if (!Array.isArray(messages)) return false;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!isRecord(message)) continue;
      const content = appendContent(message.content);
      if (content === undefined) continue;
      payload[key] = messages.map((item, itemIndex) =>
        itemIndex === index ? { ...(item as Record<string, unknown>), content } : item,
      );
      return true;
    }
    return false;
  };

  if (endpoint === "openai-responses") {
    if (typeof payload.input === "string") {
      payload.input = `${payload.input}${padding}`;
      return payload;
    }
    return appendToMessages("input") ? payload : undefined;
  }
  if (format === "openai" || format === "anthropic") return appendToMessages("messages") ? payload : undefined;
  if (!Array.isArray(payload.contents)) return undefined;
  for (let index = payload.contents.length - 1; index >= 0; index -= 1) {
    const content = payload.contents[index];
    if (!isRecord(content) || !Array.isArray(content.parts)) continue;
    const partIndex = content.parts.findIndex((part) => isRecord(part) && typeof part.text === "string");
    if (partIndex < 0) continue;
    payload.contents = payload.contents.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...(item as Record<string, unknown>),
            parts: (content.parts as unknown[]).map((part, nestedIndex) =>
              nestedIndex === partIndex
                ? {
                    ...(part as Record<string, unknown>),
                    text: `${String((part as Record<string, unknown>).text)}${padding}`,
                  }
                : part,
            ),
          }
        : item,
    );
    return payload;
  }
  return undefined;
}

/**
 * Converts internal standalone members to the routing entries a customer
 * actually sees. Visibility mode governs management access, not token routing,
 * so a pooled channel takes precedence regardless of that internal setting.
 */
export function resolveProbeCustomerFacingTargets(
  channels: RelayChannelProbeTopologyItem[],
  standaloneChannelId: string,
): RelayChannelProbeCustomerFacingTargetDto[] {
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const targetById = new Map<string, RelayChannelProbeCustomerFacingTargetDto>();
  const requested = channelById.get(standaloneChannelId);
  if (requested?.enabled && requested.channelType === "pooled") {
    return [{ channelId: requested.id, channelName: requested.name }];
  }

  const collectStandaloneMembers = (channelId: string, path = new Set<string>()): string[] => {
    if (path.has(channelId)) return [];
    const channel = channelById.get(channelId);
    if (!channel?.enabled) return [];
    if (channel.channelType === "standalone") return [channel.id];

    const nextPath = new Set(path).add(channelId);
    return (channel.poolMembers ?? []).flatMap((member) => {
      if (member.enabled === false || member.memberChannelEnabled === false) return [];
      return collectStandaloneMembers(member.memberChannelId, nextPath);
    });
  };

  for (const channel of channels) {
    if (!channel.enabled || channel.channelType !== "pooled") continue;
    if (collectStandaloneMembers(channel.id).includes(standaloneChannelId)) {
      targetById.set(channel.id, { channelId: channel.id, channelName: channel.name });
    }
  }

  if (targetById.size === 0) {
    const standalone = channelById.get(standaloneChannelId);
    if (standalone?.enabled) {
      targetById.set(standalone.id, { channelId: standalone.id, channelName: standalone.name });
    }
  }

  return [...targetById.values()].sort((left, right) => left.channelName.localeCompare(right.channelName));
}

export function readProbeJsonPath(source: unknown, path: string): unknown {
  const normalized = path
    .trim()
    .replace(/^\$\.?/, "")
    .replace(/\["([^"\\]+)"\]/g, ".$1")
    .replace(/\['([^'\\]+)'\]/g, ".$1")
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/^\./, "");
  if (!normalized) return source;
  return normalized.split(".").reduce<unknown>((value, key) => {
    if (value == null || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

export function interpolateProbeVariables(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === "string")
    return value.replace(/\{\{([A-Za-z][A-Za-z0-9_.]*)\}\}/g, (_, key) => variables[key] ?? "");
  if (Array.isArray(value)) return value.map((item) => interpolateProbeVariables(item, variables));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        interpolateProbeVariables(item, variables),
      ]),
    );
  return value;
}

/**
 * Probe workflows contain credentials and extracted values. Unlike the generic
 * interpolation helper, never turn an absent value into an empty upstream
 * header, query parameter, or request body field.
 */
export function interpolateRequiredProbeVariables(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === "string")
    return value.replace(/\{\{([A-Za-z][A-Za-z0-9_.]*)\}\}/g, (_, key) => {
      const resolved = variables[key];
      if (!resolved?.trim())
        throw new BadRequestError(`PROBE_VARIABLE_MISSING:${key}`, undefined, {
          messageKey: "relay.probeVariableMissing",
          messageParams: { variable: key },
        });
      return resolved;
    });
  if (Array.isArray(value)) return value.map((item) => interpolateRequiredProbeVariables(item, variables));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        interpolateRequiredProbeVariables(item, variables),
      ]),
    );
  return value;
}

export function normalizeProbeNetworkError(message: string): string {
  return /invalid ip address:\s*undefined/i.test(message) ? "PROBE_NETWORK_CONFIGURATION_INVALID" : message;
}

export function calculateSuggestedProbeMultiplier(
  upstreamBalanceDelta: number,
  upstreamRateMultiplier: number,
  distributionMultiplier: number,
  baseLocalCost: number,
): number | undefined {
  const value = (upstreamBalanceDelta * upstreamRateMultiplier * distributionMultiplier) / baseLocalCost;
  if (
    !Number.isFinite(value) ||
    upstreamBalanceDelta <= 0 ||
    upstreamRateMultiplier <= 0 ||
    baseLocalCost <= 0 ||
    value < 0 ||
    value > 1000
  )
    return undefined;
  // A channel multiplier must never be rounded below the measured upstream cost.
  return Math.ceil((value - Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function waitForProbeSettlement(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Uses the robust median absolute deviation rather than a mean/stddev pair, so a single bad ledger sample cannot bias calibration. */
export function findProbeOutlierIndexes(values: readonly number[], threshold = 3.5): Set<number> {
  if (values.length < 3) return new Set();
  const median = (items: readonly number[]) => {
    const ordered = [...items].sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
  };
  const center = median(values);
  const mad = median(values.map((value) => Math.abs(value - center)));
  // With zero MAD, equal samples form the baseline and every different value is a clear outlier.
  if (mad === 0) return new Set(values.flatMap((value, index) => (value === center ? [] : [index])));
  return new Set(
    values.flatMap((value, index) => (Math.abs((0.6745 * (value - center)) / mad) > threshold ? [index] : [])),
  );
}

/**
 * Strict validation is an explicit operator choice. The default retains every
 * comparable sample so a deliberate one-shot measurement can still produce a
 * usable suggestion; it never turns a malformed or non-comparable response
 * into a measurement.
 */
export function finalizeProbeCalibration(
  samples: RelayChannelProbeSampleDto[],
  strictCalibrationValidation: boolean,
): {
  accepted: RelayChannelProbeSampleDto[];
  discardedCount: number;
  calibrationStatus: RelayChannelProbeCalibrationStatus;
} {
  const candidates = samples.filter((sample) => sample.accepted && sample.suggestedMultiplier != null);
  if (strictCalibrationValidation) {
    const outlierIndexes = findProbeOutlierIndexes(candidates.map((sample) => sample.suggestedMultiplier!));
    for (const [index, sample] of candidates.entries()) {
      if (!outlierIndexes.has(index)) continue;
      sample.status = "discarded";
      sample.accepted = false;
      sample.errorMessage = "样本波动超出 MAD 3.5 阈值，已排除";
    }
  }
  const accepted = samples.filter((sample) => sample.accepted);
  const suggestedValues = accepted.flatMap((sample) =>
    sample.suggestedMultiplier == null ? [] : [sample.suggestedMultiplier],
  );
  const meanSuggestion = suggestedValues.length
    ? suggestedValues.reduce((sum, value) => sum + value, 0) / suggestedValues.length
    : 0;
  const relativeSpread =
    meanSuggestion > 0 && suggestedValues.length > 1
      ? (Math.max(...suggestedValues) - Math.min(...suggestedValues)) / meanSuggestion
      : 0;
  const calibrationStatus: RelayChannelProbeCalibrationStatus = strictCalibrationValidation
    ? samples.some((sample) => sample.status === "low_signal")
      ? "low-signal"
      : samples.some((sample) => sample.status === "settlement_timeout")
        ? "unstable"
        : accepted.length < MIN_VERIFIED_SAMPLE_COUNT
          ? "insufficient-samples"
          : relativeSpread <= MAX_ACCEPTED_SAMPLE_SPREAD
            ? "verified"
            : "unstable"
    : accepted.length > 0
      ? "verified"
      : samples.some((sample) => sample.status === "low_signal")
        ? "low-signal"
        : samples.some((sample) => sample.status === "settlement_timeout")
          ? "unstable"
          : "insufficient-samples";
  return {
    accepted,
    discardedCount: samples.filter((sample) => sample.status === "discarded").length,
    calibrationStatus,
  };
}

function averageProbeSampleValue(
  samples: readonly RelayChannelProbeSampleDto[],
  key: keyof RelayChannelProbeSampleDto,
) {
  const values = samples
    .map((sample) => sample[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

/**
 * Axios treats an explicitly supplied empty object as a JSON request body. A
 * balance workflow normally uses GET and several upstreams reject even that
 * empty body (for example with HTTP 413). Omit it entirely unless the step is
 * a body-capable request with actual fields to send.
 */
export function getProbeWorkflowRequestBody(method: string, body: unknown): unknown {
  if (method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD") return undefined;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length === 0) return undefined;
  return body;
}

/** GET/HEAD balance reads must not retain stale body transport headers from imported templates. */
export function getProbeWorkflowHeaders(method: string, headers: Record<string, string>): Record<string, string> {
  if (method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") return headers;
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !["content-length", "transfer-encoding"].includes(name.toLowerCase())),
  );
}

/** An ungrouped channel is its own scheduling scope; grouped channels serialize by group. */
export function getProbeSchedulingScope(channelId: string, probeGroup: string | null | undefined): string {
  const normalizedGroup = probeGroup?.trim().toLocaleLowerCase();
  return normalizedGroup ? `group:${normalizedGroup}` : `channel:${channelId}`;
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
  if (!rate) throw new BadRequestError("探针模型没有本地定价配置");
  const upstreamModelId = rate.modelId?.trim() || resolveModelId(rate).trim();
  if (!upstreamModelId) throw new BadRequestError("探针模型缺少上游模型标识");
  return { rate, upstreamModelId };
}

type ProbeUsage = {
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

/**
 * Probe URLs are configured as API base URLs. Some providers include the API
 * version in that base URL while others use the origin only, so avoid adding a
 * duplicate version segment in either case.
 */
export function buildProbeUpstreamEndpoint(
  upstreamUrl: string,
  format: "openai" | "anthropic" | "gemini",
  model: string,
  endpoint: RelayChannelProbeEndpoint = defaultProbeEndpoint(format),
): string {
  assertProbeEndpointCompatibility(endpoint, format);
  const base = new URL(upstreamUrl);
  const endpointPath =
    endpoint === "openai-responses"
      ? "/v1/responses"
      : endpoint === "openai-chat-completions"
        ? "/v1/chat/completions"
        : format === "anthropic"
          ? "/v1/messages"
          : `/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const normalizedBasePath = base.pathname.replace(/\/+$/, "");
  const normalizedEndpointPath = endpointPath.replace(/^\/+/, "");
  const endpointWithLeadingSlash = `/${normalizedEndpointPath}`;
  const path =
    normalizedBasePath && endpointWithLeadingSlash.startsWith(`${normalizedBasePath}/`)
      ? endpointWithLeadingSlash.slice(normalizedBasePath.length)
      : endpointWithLeadingSlash;
  base.pathname = `${normalizedBasePath}/${path.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
  return base.toString();
}

export function assertProbeUsage(usage: ProbeUsage): void {
  if (usage.totalTokens > 0) return;
  throw new BadRequestError("最小模型请求未返回可计费用量；请确认上游地址包含正确 API 版本、请求格式和模型。");
}

function redactProbeErrorText(value: string): string {
  return value
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, "$1 [REDACTED]")
    .replace(/([?&](?:api[_-]?key|key|token|authorization)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|rk|dpk)_[A-Za-z0-9_-]+\b/gi, "[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 300);
}

function readProbeUpstreamMessage(data: unknown): string | undefined {
  if (typeof data === "string") return redactProbeErrorText(data) || undefined;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  const direct = [record.message, record.msg, record.detail, record.error_description].find(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
  if (direct) return redactProbeErrorText(direct) || undefined;
  const nestedError = record.error;
  if (typeof nestedError === "string") return redactProbeErrorText(nestedError) || undefined;
  if (!nestedError || typeof nestedError !== "object" || Array.isArray(nestedError)) return undefined;
  const nested = nestedError as Record<string, unknown>;
  const nestedMessage = [nested.message, nested.msg, nested.detail].find(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
  return nestedMessage ? redactProbeErrorText(nestedMessage) || undefined : undefined;
}

/** Formats upstream failures without exposing credentials, response bodies, or query parameters. */
export function formatProbeUpstreamError(
  status: number | undefined,
  requestUrl: string | undefined,
  responseData: unknown,
): string {
  let endpoint = "";
  if (requestUrl) {
    try {
      endpoint = new URL(requestUrl).pathname;
    } catch {
      endpoint = "";
    }
  }
  const parts = [
    status ? `上游响应 HTTP ${status}${endpoint ? `（${endpoint}）` : ""}` : "上游请求失败",
    readProbeUpstreamMessage(responseData),
  ].filter((value): value is string => Boolean(value));
  const details = parts.join("：");
  if (
    status === 403 &&
    /(?:\bip\b|IP|地址).{0,80}(?:white|allow|permit|白名单|允许|访问)|(?:white|allow|permit|白名单|允许访问).{0,80}(?:\bip\b|IP|地址)/i.test(
      details,
    )
  )
    parts.push("上游令牌 IP 白名单拒绝：请在上游将本服务端的公网出口 IP 加入允许列表；浏览器 IP 不参与服务端探针");
  else if (status === 401 || status === 403)
    parts.push("请检查渠道的上游 API Key、该 Key 的模型权限；余额工作流凭据不会替代渠道上游 Key");
  return parts.join("：");
}

function toNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

export class RelayChannelProbeService {
  private static instance: RelayChannelProbeService;
  private scheduling = false;
  private schedulerTimer: ReturnType<typeof setInterval> | undefined;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;
  private readonly activeRunIds = new Set<string>();
  private readonly activeSchedulingScopes = new Set<string>();
  private lastCleanupAt = 0;
  private readonly channelLockService = RelayChannelProbeLockService.getInstance();
  private readonly relayChannelRepository = RelayChannelRepository.getInstance();
  private readonly repository = RelayChannelProbeRepository.getInstance();
  private readonly redis = RedisService.getInstance();

  static getInstance(): RelayChannelProbeService {
    if (!this.instance) this.instance = new RelayChannelProbeService();
    return this.instance;
  }

  async listOverview(actorUserId: string): Promise<RelayChannelProbeOverviewItemDto[]> {
    const [channels, topology] = await Promise.all([
      RelayChannelService.getInstance().listChannels(actorUserId, true),
      this.listChannelTopology(),
    ]);
    const probeableChannels = channels.filter((channel) => isProbeableChannelType(channel.channelType));
    const channelIds = probeableChannels.map((item) => item.id);
    const [profiles, runs] = await Promise.all([
      this.repository.listProfiles(channelIds),
      this.repository.listLatestRuns(channelIds),
    ]);
    const profileMap = new Map(profiles.map((profile) => [profile.relayChannelId, profile]));
    const runMap = new Map(runs.map((run) => [run.relayChannelId, run]));
    return probeableChannels.map((channel) => ({
      channelId: channel.id,
      channelName: channel.name,
      enabled: channel.enabled,
      visibilityMode: channel.visibilityMode,
      customerFacingTargets: resolveProbeCustomerFacingTargets(topology, channel.id),
      multiplier: channel.multiplier,
      allowedProbeFormats: this.toAllowedProbeFormats(channel.allowedFormats),
      allowedProbeModels: channel.allowedModels,
      profile: profileMap.has(channel.id) ? this.toProfileDto(profileMap.get(channel.id)!) : undefined,
      latestRun: runMap.has(channel.id) ? this.toRunDto(runMap.get(channel.id)!) : undefined,
    }));
  }

  /**
   * Probe readers can only inspect channels they are allowed to manage, but a
   * member's customer-facing pool can use a private management visibility mode.
   * Read the topology separately so notices consistently use the pool label.
   */
  private async listChannelTopology(): Promise<RelayChannelProbeTopologyItem[]> {
    const channels = await this.relayChannelRepository.listVisible();
    return channels.map((channel) => {
      const members = (
        channel as typeof channel & {
          poolMembers?: Array<{
            memberChannelId: string;
            priority: number;
            weight: number;
            enabled: boolean;
            memberChannel?: { status: number } | null;
          }>;
        }
      ).poolMembers;
      return {
        id: channel.id,
        name: channel.name,
        enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
        channelType: channel.channelType as RelayChannelType,
        poolMembers: members?.map(
          (member): RelayChannelMemberDto => ({
            memberChannelId: member.memberChannelId,
            priority: member.priority,
            weight: Number(member.weight),
            enabled: member.enabled,
            memberChannelEnabled: member.memberChannel?.status === RELAY_CHANNEL_STATUS.ENABLED,
          }),
        ),
      };
    });
  }

  async getProfile(channelId: string, actorUserId: string): Promise<RelayChannelProbeProfileDto> {
    await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    const profile = await this.repository.findProfile(channelId);
    if (!profile) throw new NotFoundError("渠道探针档案不存在");
    return this.toProfileDto(profile);
  }

  async upsertProfile(channelId: string, body: UpsertRelayChannelProbeProfileRequest, actorUserId: string) {
    const channel = await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    if (!isProbeableChannelType(channel.channelType)) throw new BadRequestError("仅独立渠道或逻辑混池支持余额探针");
    this.assertProbeChannelCompatibility(channel, body.probeFormat, body.probeModel);
    const existing = await this.repository.findProfile(channelId);
    const probeEndpoint = body.probeEndpoint ?? normalizeProbeEndpoint(existing?.probeEndpoint, body.probeFormat);
    assertProbeEndpointCompatibility(probeEndpoint, body.probeFormat);
    const cacheMode: RelayChannelProbeCacheMode =
      body.cacheMode ??
      (body.preventCache === false
        ? "allow-cache"
        : body.preventCache === true
          ? "cache-bust"
          : ((existing?.cacheMode as RelayChannelProbeCacheMode | undefined) ?? "cache-bust"));
    const preventCache = body.cacheMode
      ? cacheMode === "cache-bust"
      : (body.preventCache ?? existing?.preventCache ?? true);
    const encrypted = body.credentials ? this.encryptCredentials(body.credentials) : undefined;
    const memberCredentials = body.memberCredentials
      ? Object.fromEntries(
          Object.entries(body.memberCredentials).map(([memberId, credentials]) => [memberId, credentials]),
        )
      : undefined;
    const encryptedMemberCredentials = memberCredentials ? this.encryptCredentials(memberCredentials) : undefined;
    if (channel.channelType === "pooled") {
      if (body.credentials) throw new BadRequestError("逻辑混池必须按物理成员配置探针凭据");
      const pooled = await this.relayChannelRepository.findVisibleById(channelId);
      const activeMemberIds = (
        (pooled as (RelayChannel & { pooledChildren?: RelayChannel[] }) | null)?.pooledChildren ?? []
      )
        .filter(
          (member: RelayChannel) =>
            member.channelType === "pooled-member" &&
            member.status === RELAY_CHANNEL_STATUS.ENABLED &&
            member.pooledMemberEnabled !== false,
        )
        .map((member: RelayChannel) => member.id);
      const supplied = memberCredentials ? new Set(Object.keys(memberCredentials)) : undefined;
      if (!existing && !supplied) throw new BadRequestError("首次配置逻辑混池探针必须提供各物理成员凭据");
      if (supplied && activeMemberIds.some((memberId: string) => !supplied.has(memberId)))
        throw new BadRequestError("逻辑混池缺少启用物理成员的探针凭据");
    } else if (body.memberCredentials) {
      throw new BadRequestError("仅逻辑混池可按成员配置探针凭据");
    } else if (!existing && !encrypted) {
      throw new BadRequestError("首次配置探针必须提供凭据");
    }
    const profile = await this.repository.upsertProfile({
      where: { relayChannelId: channelId },
      create: {
        relayChannelId: channelId,
        enabled: body.enabled,
        probeFormat: body.probeFormat,
        probeEndpoint,
        probeModel: body.probeModel,
        probePayload: body.probePayload as Prisma.InputJsonValue,
        preventCache,
        cacheMode,
        sampleCount: body.sampleCount ?? existing?.sampleCount ?? MIN_VERIFIED_SAMPLE_COUNT,
        strictCalibrationValidation: body.strictCalibrationValidation ?? existing?.strictCalibrationValidation ?? false,
        measurementInputTokens: body.measurementInputTokens ?? existing?.measurementInputTokens ?? 1024,
        balanceSettlementTolerance: body.balanceSettlementTolerance ?? existing?.balanceSettlementTolerance ?? 0.000001,
        balanceSettlementReads: body.balanceSettlementReads ?? existing?.balanceSettlementReads ?? 2,
        upstreamCurrency: body.upstreamCurrency || "CNY",
        localCurrency: body.localCurrency || "CNY",
        upstreamBalanceDivisor: body.upstreamBalanceDivisor ?? 1,
        upstreamRateMultiplier: body.upstreamRateMultiplier ?? 1,
        probeGroup: this.normalizeProbeGroup(body.probeGroup),
        distributionMultiplier: body.distributionMultiplier ?? 1,
        workflow: body.workflow as unknown as Prisma.InputJsonValue,
        encryptedCredentials: encryptedMemberCredentials?.ciphertext ?? encrypted?.ciphertext,
        credentialIv: encryptedMemberCredentials?.iv ?? encrypted?.iv,
        credentialAuthTag: encryptedMemberCredentials?.authTag ?? encrypted?.authTag,
      },
      update: {
        enabled: body.enabled,
        probeFormat: body.probeFormat,
        probeEndpoint,
        probeModel: body.probeModel,
        probePayload: body.probePayload as Prisma.InputJsonValue,
        preventCache,
        cacheMode,
        sampleCount: body.sampleCount ?? existing?.sampleCount ?? MIN_VERIFIED_SAMPLE_COUNT,
        strictCalibrationValidation: body.strictCalibrationValidation ?? existing?.strictCalibrationValidation ?? false,
        measurementInputTokens: body.measurementInputTokens ?? existing?.measurementInputTokens ?? 1024,
        balanceSettlementTolerance: body.balanceSettlementTolerance ?? existing?.balanceSettlementTolerance ?? 0.000001,
        balanceSettlementReads: body.balanceSettlementReads ?? existing?.balanceSettlementReads ?? 2,
        upstreamCurrency: body.upstreamCurrency || "CNY",
        localCurrency: body.localCurrency || "CNY",
        upstreamBalanceDivisor: body.upstreamBalanceDivisor ?? 1,
        upstreamRateMultiplier: body.upstreamRateMultiplier ?? 1,
        probeGroup: this.normalizeProbeGroup(body.probeGroup),
        distributionMultiplier: body.distributionMultiplier ?? 1,
        workflow: body.workflow as unknown as Prisma.InputJsonValue,
        ...(encryptedMemberCredentials || encrypted
          ? {
              encryptedCredentials: (encryptedMemberCredentials ?? encrypted)!.ciphertext,
              credentialIv: (encryptedMemberCredentials ?? encrypted)!.iv,
              credentialAuthTag: (encryptedMemberCredentials ?? encrypted)!.authTag,
            }
          : {}),
      },
    });
    return this.toProfileDto(profile);
  }

  async clearProfile(channelId: string, actorUserId: string): Promise<void> {
    await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    await this.channelLockService.withWrite(channelId, async () => {
      if (await this.repository.findActiveRun(channelId))
        throw new ConflictError("渠道存在排队或运行中的探针，暂时不能清空档案");
      if (!(await this.repository.findProfile(channelId))) throw new NotFoundError("渠道探针档案不存在");
      await this.repository.deleteProfile(channelId);
    });
  }

  /** Cancels stuck queued/running work and releases its queue slot without changing the probe profile. */
  async resetRunState(channelId: string, actorUserId: string): Promise<void> {
    await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    const runIds = await this.repository.cancelActiveRuns(channelId, "探针任务已由操作人员重置");
    await Promise.all(
      runIds.map((runId) => this.redis.deleteIfValueMatches(this.getRunQueueSlotKey(channelId), runId)),
    );
    // A process restart can leave only the Redis reservation behind. At this point
    // all persisted active runs have been cancelled, so force-release the exact
    // channel slot even when there was no matching database row.
    await this.redis.delete(this.getRunQueueSlotKey(channelId));
  }

  async createRun(
    channelId: string,
    body: CreateRelayChannelProbeRunRequest,
    actorUserId: string,
  ): Promise<RelayChannelProbeRunDto> {
    const channel = await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    const profile = await this.repository.findProfileWithChannel(channelId);
    if (!profile) throw new NotFoundError("渠道探针档案不存在");
    if (!profile.enabled) throw new BadRequestError("渠道探针已停用");
    this.assertProbeChannelCompatibility(channel, profile.probeFormat, profile.probeModel);
    const probeEndpoint = normalizeProbeEndpoint(profile.probeEndpoint, profile.probeFormat as ProbeFormat);
    if (!isProbeableChannelType(profile.relayChannel.channelType as RelayChannelType))
      throw new BadRequestError("仅独立渠道或逻辑混池支持余额探针");
    const active = await this.repository.findActiveRun(channelId);
    if (active) throw new ConflictError("该渠道已有探针任务正在排队或执行");
    if (!this.redis.isRedisAvailable())
      throw new LockBackendUnavailableError("Relay channel probe queue backend unavailable");
    const reservationId = randomUUID();
    const queueKey = this.getRunQueueSlotKey(channelId);
    const reserved = await this.redis.setIfNotExists(queueKey, reservationId, RUN_QUEUE_SLOT_TTL_MS);
    if (reserved === null) throw new LockBackendUnavailableError("Relay channel probe queue backend unavailable");
    if (!reserved) throw new ConflictError("该渠道已有探针任务正在排队或执行");

    try {
      const run = await this.repository.createRun({
        relayChannelId: channelId,
        profileId: profile.id,
        requestedByUserId: actorUserId,
        distributionMultiplier: body.distributionMultiplier ?? profile.distributionMultiplier,
        cacheBustingEnabled: profile.cacheMode === "cache-bust",
        probeEndpoint,
        cacheMode: profile.cacheMode,
        sampleCount: profile.sampleCount,
        strictCalibrationValidation: profile.strictCalibrationValidation,
        measurementInputTokens: profile.measurementInputTokens,
        balanceSettlementTolerance: profile.balanceSettlementTolerance,
        balanceSettlementReads: profile.balanceSettlementReads,
        forceWithoutCacheBuster: body.forceWithoutCacheBuster === true,
      });
      const attached = await this.redis.replaceIfValueMatches(queueKey, reservationId, run.id, RUN_QUEUE_SLOT_TTL_MS);
      // The persistent run remains authoritative if Redis recovers between the
      // reservation and attachment. The database active-run check still keeps
      // later submissions from creating a second task.
      if (attached !== true)
        logger.warn("Relay channel probe queue slot could not be attached", { channelId, runId: run.id });
      return this.toRunDto(run);
    } catch (error) {
      await this.redis.deleteIfValueMatches(queueKey, reservationId).catch(() => null);
      throw error;
    }
  }

  async createRuns(
    body: CreateRelayChannelProbeRunsRequest,
    actorUserId: string,
  ): Promise<CreateRelayChannelProbeRunsResponse> {
    const queued: RelayChannelProbeRunDto[] = [];
    const rejected: Array<{ channelId: string; reason: string }> = [];

    // Queue one record at a time so a blocked or already-running channel never prevents
    // independent channels from being scheduled.
    for (const channelId of body.channelIds) {
      try {
        queued.push(
          await this.createRun(
            channelId,
            {
              distributionMultiplier: body.distributionMultiplier,
              forceWithoutCacheBuster: body.forceWithoutCacheBuster,
            },
            actorUserId,
          ),
        );
      } catch (error) {
        rejected.push({
          channelId,
          reason: error instanceof Error ? error.message : "探针任务创建失败",
        });
      }
    }
    return { queued, rejected };
  }

  /**
   * Copies a profile entirely within the server. In particular, encrypted
   * workflow credentials never need to be decrypted or exposed to the UI.
   * Targets are handled independently so one incompatible channel does not
   * prevent the operator from configuring the rest of the selected set.
   */
  async copyProfile(
    body: CopyRelayChannelProbeProfileRequest,
    actorUserId: string,
  ): Promise<CopyRelayChannelProbeProfileResponse> {
    const channelService = RelayChannelService.getInstance();
    const sourceChannel = await channelService.getChannel(body.sourceChannelId, actorUserId);
    if (!isProbeableChannelType(sourceChannel.channelType))
      throw new BadRequestError("仅独立渠道或逻辑混池支持余额探针");
    const sourceProfile = await this.repository.findProfileWithChannel(body.sourceChannelId);
    if (!sourceProfile) throw new NotFoundError("来源渠道尚未配置探针档案");

    const copied: RelayChannelProbeProfileDto[] = [];
    const rejected: Array<{ channelId: string; reason: string }> = [];
    for (const channelId of body.targetChannelIds) {
      try {
        const targetChannel = await channelService.getChannel(channelId, actorUserId);
        if (!isProbeableChannelType(targetChannel.channelType)) {
          rejected.push({ channelId, reason: "仅独立渠道或逻辑混池支持余额探针" });
          continue;
        }
        if (targetChannel.channelType !== sourceChannel.channelType) {
          rejected.push({ channelId, reason: "独立渠道与逻辑混池的探针凭据结构不兼容" });
          continue;
        }
        this.assertProbeChannelCompatibility(targetChannel, sourceProfile.probeFormat, sourceProfile.probeModel);
        const [existing, activeRun] = await Promise.all([
          this.repository.findProfile(channelId),
          this.repository.findActiveRun(channelId),
        ]);
        if (activeRun) {
          rejected.push({ channelId, reason: "渠道存在排队或运行中的探针，暂时不能覆盖档案" });
          continue;
        }
        if (existing && !body.overwriteExisting) {
          rejected.push({ channelId, reason: "目标渠道已有探针档案，未选择覆盖" });
          continue;
        }
        copied.push(this.toProfileDto(await this.repository.copyProfile(sourceProfile, channelId)));
      } catch (error) {
        rejected.push({
          channelId,
          reason: error instanceof Error ? this.safeError(error) : "无法复制探针档案",
        });
      }
    }
    return { copied, rejected };
  }

  async listRuns(channelId: string, actorUserId: string, page = 1, pageSize = 20) {
    await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    const result = await this.repository.listRuns(channelId, page, pageSize);
    return { items: result.items.map((record) => this.toRunDto(record)), total: result.total, page, pageSize };
  }

  async clearRunHistory(
    channelId: string,
    scope: RelayChannelProbeRunHistoryScope,
    actorUserId: string,
  ): Promise<ClearRelayChannelProbeRunHistoryResponse> {
    await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    const result = await this.repository.clearRunHistory(channelId, scope);
    return { deleted: result.count };
  }

  async applyRuns(
    body: ApplyRelayChannelProbeRunsRequest,
    actorUserId: string,
  ): Promise<ApplyRelayChannelProbeRunsResponse> {
    const runs = await this.repository.findRunsWithChannels(body.runIds);
    const overrides = new Map((body.overrides || []).map((item) => [item.runId, item.multiplier]));
    const rejected: Array<{ runId: string; reason: string }> = [];
    let applied = 0;
    for (const run of runs) {
      try {
        await RelayChannelService.getInstance().getChannel(run.relayChannelId, actorUserId);
        if (run.status !== "succeeded" || run.suggestedMultiplier == null || run.appliedAt)
          throw new BadRequestError("探针结果不可应用");
        if (run.calibrationStatus !== "verified") throw new BadRequestError("探针结果未通过稳定性校验");
        if (!run.finishedAt || Date.now() - run.finishedAt.getTime() > SUGGESTION_MAX_AGE_MS)
          throw new BadRequestError("探针建议已过期");
        if (
          run.sourceChannelMultiplier == null ||
          Number(run.relayChannel.multiplier) !== Number(run.sourceChannelMultiplier)
        )
          throw new ConflictError("渠道倍率已变更，请重新探针");
        if (!run.profile || !run.pricingFingerprint) throw new BadRequestError("旧探针结果缺少计费快照，不可应用");
        const currentPricing = await this.resolveProbeModelPricing(run.profile);
        const currentFingerprint = this.fingerprintPricingSnapshot(
          await this.createPricingSnapshot(run.profile, currentPricing.rate),
        );
        if (currentFingerprint !== run.pricingFingerprint) throw new ConflictError("探针计费配置已变更，请重新探针");
        const targetMultiplier = overrides.get(run.id) ?? Number(run.suggestedMultiplier);
        const sourceMultiplier = Number(run.sourceChannelMultiplier);
        if (
          !body.forceLargeChange &&
          Math.abs(targetMultiplier - sourceMultiplier) / Math.max(sourceMultiplier, Number.EPSILON) >
            LARGE_MULTIPLIER_CHANGE_RATIO
        ) {
          const previous = await this.repository.findRecentVerifiedRuns(
            run.relayChannelId,
            run.id,
            new Date(Date.now() - SUGGESTION_MAX_AGE_MS),
          );
          const previousSuggestedMultiplier =
            previous[0]?.suggestedMultiplier == null ? undefined : Number(previous[0].suggestedMultiplier);
          if (requiresLargeMultiplierConfirmation(sourceMultiplier, targetMultiplier, previousSuggestedMultiplier))
            throw new BadRequestError("大幅倍率变更需要另一条独立、稳定的探针结果确认");
        }
        const appliedRun = await this.repository.applySuggestedMultiplier({
          runId: run.id,
          channelId: run.relayChannelId,
          expectedMultiplier: run.sourceChannelMultiplier,
          suggestedMultiplier: targetMultiplier,
          actorUserId,
        });
        if (!appliedRun) throw new ConflictError("渠道倍率已变更，请重新探针");
        applied += 1;
      } catch (error) {
        rejected.push({ runId: run.id, reason: error instanceof Error ? error.message : "应用失败" });
      }
    }
    const foundRunIds = new Set(runs.map((run) => run.id));
    for (const runId of body.runIds) if (!foundRunIds.has(runId)) rejected.push({ runId, reason: "探针记录不存在" });
    return { applied, rejected };
  }

  start(): void {
    if (this.schedulerTimer) return;
    this.schedulerTimer = setInterval(() => void this.schedulePendingRuns(), 5_000);
    this.schedulerTimer.unref();
    this.cleanupTimer = setInterval(() => void this.cleanupExpiredRuns(), 60 * 60 * 1000);
    this.cleanupTimer.unref();
    void this.schedulePendingRuns();
    void this.cleanupExpiredRuns();
  }

  stop(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.schedulerTimer = undefined;
    this.cleanupTimer = undefined;
  }

  private async schedulePendingRuns(): Promise<void> {
    if (this.scheduling) return;
    this.scheduling = true;
    try {
      const availableSlots = MAX_CONCURRENT_PROBE_RUNS - this.activeRunIds.size;
      if (availableSlots <= 0) return;
      const now = new Date();
      // Inspect more than the immediate capacity so a queued job in an active
      // group never prevents an independent group from starting.
      const candidates = await this.repository.findClaimableRuns(now, availableSlots * 8);
      for (const candidate of candidates) {
        if (this.activeRunIds.size >= MAX_CONCURRENT_PROBE_RUNS) break;
        const scope = getProbeSchedulingScope(candidate.relayChannelId, candidate.profile?.probeGroup);
        if (this.activeRunIds.has(candidate.id) || this.activeSchedulingScopes.has(scope)) continue;

        const owner = randomUUID();
        const claimed = await this.repository.claimRun(candidate.id, owner, now, new Date(Date.now() + RUN_LEASE_MS));
        if (!claimed.count) continue;

        this.activeRunIds.add(candidate.id);
        this.activeSchedulingScopes.add(scope);
        void this.executeRun(candidate.id, owner)
          .catch((error) =>
            logger.error("Relay channel probe worker crashed", { runId: candidate.id, error: this.safeError(error) }),
          )
          .finally(() => {
            this.activeRunIds.delete(candidate.id);
            this.activeSchedulingScopes.delete(scope);
            void this.schedulePendingRuns();
          });
      }
    } finally {
      this.scheduling = false;
    }
  }

  private async executeRun(runId: string, owner: string): Promise<void> {
    const run = await this.repository.findRunWithProfile(runId);
    if (!run || run.leaseOwner !== owner) return;
    if (!run.profile) {
      await this.repository.completeClaimedRun(runId, owner, {
        status: "cancelled",
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        errorMessage: "探针档案已清空，任务已取消",
      });
      return;
    }
    const leaseHeartbeat = setInterval(
      () => {
        void this.repository.heartbeatRun(runId, owner, new Date(Date.now() + RUN_LEASE_MS));
      },
      Math.floor(RUN_LEASE_MS / 3),
    );
    leaseHeartbeat.unref();
    try {
      const profile = run.profile;
      const pricing = await this.resolveProbeModelPricing(profile);
      const executeSamples = () =>
        this.channelLockService.withWrite(
          profile.relayChannelId,
          () => this.executeSamples(profile, run, pricing),
          PROBE_LOCK_ACQUIRE_TIMEOUT_MS,
        );
      const result = profile.probeGroup
        ? await this.channelLockService.withWrite(
            this.getProbeGroupLockId(profile.probeGroup),
            executeSamples,
            GROUP_LOCK_TIMEOUT_MS,
          )
        : await executeSamples();
      await this.repository.completeClaimedRun(runId, owner, {
        status: result.succeededCount ? "succeeded" : "failed",
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        upstreamBalanceBefore: result.upstreamBalanceBefore,
        upstreamBalanceAfter: result.upstreamBalanceAfter,
        upstreamBalanceDelta: result.upstreamBalanceDelta,
        upstreamRateMultiplier: Number(profile.upstreamRateMultiplier),
        localBalanceBefore: 0,
        localBalanceAfter: result.localBalanceDelta == null ? 0 : -result.localBalanceDelta,
        localBalanceDelta: result.localBalanceDelta ?? 0,
        baseLocalCost: result.baseLocalCost,
        requestTokens: result.requestTokens,
        responseTokens: result.responseTokens,
        totalTokens: result.totalTokens,
        cacheCreationTokens: result.cacheCreationTokens,
        cacheReadTokens: result.cacheReadTokens,
        cacheBusterId: result.samples.find((sample) => sample.accepted)?.cacheBusterId,
        upstreamUsage: result.upstreamUsage as Prisma.InputJsonValue,
        costBreakdown: result.costBreakdown as unknown as Prisma.InputJsonValue,
        suggestedMultiplier: result.suggestedMultiplier,
        sourceChannelMultiplier: profile.relayChannel.multiplier,
        sampleSucceededCount: result.succeededCount,
        sampleAcceptedCount: result.acceptedCount,
        sampleDiscardedCount: result.discardedCount,
        warmupRequestCount: result.warmupRequestCount,
        warmupCacheCreationTokens: result.warmupCacheCreationTokens,
        warmupCacheReadTokens: result.warmupCacheReadTokens,
        warmupUsage: result.warmupUsage as Prisma.InputJsonValue,
        samples: result.samples as unknown as Prisma.InputJsonValue,
        calibrationStatus: result.calibrationStatus,
        pricingFingerprint: result.pricingFingerprint,
        pricingSnapshot: result.pricingSnapshot as Prisma.InputJsonValue,
        balanceSnapshots: result.balanceSnapshots as Prisma.InputJsonValue,
        errorMessage: result.succeededCount ? null : (result.samples[0]?.errorMessage ?? "所有探针样本均失败"),
      });
    } catch (error) {
      await this.repository.completeClaimedRun(runId, owner, {
        status: axios.isAxiosError(error) && error.code === "ECONNABORTED" ? "timed_out" : "failed",
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        errorMessage: this.safeError(error),
      });
    } finally {
      clearInterval(leaseHeartbeat);
      await this.redis
        .deleteIfValueMatches(this.getRunQueueSlotKey(run.profile.relayChannelId), runId)
        .catch(() => null);
    }
  }

  private async executeSamples(
    profile: ProbeProfileRecord,
    run: ProbeRunRecord,
    pricing: { rate: ModelPricingItemDto; upstreamModelId: string },
  ) {
    const workflow = profile.workflow as unknown as RelayChannelProbeWorkflowStepDto[];
    const samples: RelayChannelProbeSampleDto[] = [];
    const warmups: Array<{ cacheCreationTokens: number; cacheReadTokens: number; usage: Record<string, unknown> }> = [];
    let costBreakdown: RelayChannelProbeCostBreakdownDto | undefined;
    const pricingSnapshot = await this.createPricingSnapshot(profile, pricing.rate);
    const balanceTolerance = Number(profile.balanceSettlementTolerance);
    const balanceReads = profile.balanceSettlementReads;
    for (let index = 0; index < run.sampleCount; index += 1) {
      try {
        const executionChannel = this.resolveProbeExecutionChannel(profile, index);
        const variables = this.resolveProbeVariables(profile, executionChannel.id);
        const cacheBusterId = run.cacheMode === "allow-cache" ? undefined : randomUUID();
        if (run.cacheMode === "warm-and-read") {
          const warmupBefore = await this.runProbePhase("读取预热前稳定余额", () =>
            this.readSettledBalance(workflow, { ...variables }, balanceTolerance, balanceReads),
          );
          const warmup = await this.runProbePhase("缓存预热请求", () =>
            this.callUpstream(
              profile,
              executionChannel,
              variables,
              pricing.upstreamModelId,
              true,
              run.forceWithoutCacheBuster,
              cacheBusterId,
              run.probeEndpoint as RelayChannelProbeEndpoint,
            ),
          );
          const warmupUsage = this.extractUsage(warmup.response);
          assertProbeUsage(warmupUsage);
          warmups.push({
            cacheCreationTokens: warmupUsage.cacheCreationTokens,
            cacheReadTokens: warmupUsage.cacheReadTokens,
            usage: warmupUsage.upstreamUsage,
          });
          // A warmup must finish posting before its matching measurement baseline.
          await this.readSettledBalance(
            workflow,
            { ...variables },
            balanceTolerance,
            balanceReads,
            warmupBefore.balance,
          );
        }
        const before = await this.runProbePhase("读取请求前稳定余额", () =>
          this.readSettledBalance(workflow, { ...variables }, balanceTolerance, balanceReads),
        );
        await waitForProbeSettlement(PROBE_BEFORE_REQUEST_SETTLEMENT_DELAY_MS);
        const upstream = await this.runProbePhase("最小模型请求", () =>
          this.callUpstream(
            profile,
            executionChannel,
            variables,
            pricing.upstreamModelId,
            run.cacheMode !== "allow-cache",
            run.forceWithoutCacheBuster,
            cacheBusterId,
            run.probeEndpoint as RelayChannelProbeEndpoint,
          ),
        );
        const usage = this.extractUsage(upstream.response);
        assertProbeUsage(usage);
        const after = await this.runProbePhase("等待上游扣费稳定", () =>
          this.readSettledBalance(workflow, { ...variables }, balanceTolerance, balanceReads, before.balance),
        );
        const divisor = Number(profile.upstreamBalanceDivisor);
        if (!Number.isFinite(divisor) || divisor <= 0) throw new BadRequestError("上游余额换算除数无效");
        const upstreamBalanceBefore = before.balance / divisor;
        const upstreamBalanceAfter = after.balance / divisor;
        const upstreamBalanceDelta = upstreamBalanceBefore - upstreamBalanceAfter;
        const calculated = await this.calculateBaseCost(profile, usage, pricing.rate);
        costBreakdown ??= calculated.breakdown;
        const cacheHitVerified = run.cacheMode !== "warm-and-read" || usage.cacheReadTokens > 0;
        const measurementInputInjected = upstream.measurementInputInjected;
        const hasMeasurableBalanceDelta = upstreamBalanceDelta > balanceTolerance;
        const comparable =
          cacheHitVerified &&
          measurementInputInjected &&
          hasMeasurableBalanceDelta &&
          profile.upstreamCurrency === profile.localCurrency &&
          calculated.baseCost > 0 &&
          usage.totalTokens > 0;
        const suggestedMultiplier = comparable
          ? calculateSuggestedProbeMultiplier(
              upstreamBalanceDelta,
              Number(profile.upstreamRateMultiplier),
              Number(run.distributionMultiplier),
              calculated.baseCost,
            )
          : undefined;
        const status = !measurementInputInjected || !hasMeasurableBalanceDelta ? "low_signal" : "succeeded";
        samples.push({
          index: index + 1,
          status,
          accepted: suggestedMultiplier != null,
          cacheBusterId: upstream.cacheBusterId,
          upstreamBalanceBefore,
          upstreamBalanceAfter,
          upstreamBalanceDelta,
          baseLocalCost: calculated.baseCost,
          requestTokens: usage.requestTokens,
          responseTokens: usage.responseTokens,
          totalTokens: usage.totalTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          cacheReadTokens: usage.cacheReadTokens,
          upstreamUsage: usage.upstreamUsage,
          suggestedMultiplier,
          cacheHitVerified,
          measurementInputInjected,
          balanceSnapshots: [
            ...before.snapshots.map((snapshot) => ({ phase: "before" as const, ...snapshot })),
            ...after.snapshots.map((snapshot) => ({ phase: "after" as const, ...snapshot })),
          ],
          errorMessage: !measurementInputInjected
            ? "当前请求体不包含可扩展的文本字段，无法形成足够测量信号"
            : !hasMeasurableBalanceDelta
              ? "余额变化低于配置的最小可分辨阈值"
              : cacheHitVerified
                ? undefined
                : "缓存命中未被上游用量验证",
        });
      } catch (error) {
        const errorMessage = this.safeError(error);
        samples.push({
          index: index + 1,
          status: errorMessage.includes("PROBE_BALANCE_SETTLEMENT_TIMEOUT") ? "settlement_timeout" : "failed",
          accepted: false,
          errorMessage,
        });
      }
    }
    const { accepted, discardedCount, calibrationStatus } = finalizeProbeCalibration(
      samples,
      run.strictCalibrationValidation,
    );
    const baseLocalCost = averageProbeSampleValue(accepted, "baseLocalCost");
    const upstreamBalanceDelta = averageProbeSampleValue(accepted, "upstreamBalanceDelta");
    const localBalanceDelta =
      upstreamBalanceDelta == null
        ? undefined
        : upstreamBalanceDelta * Number(profile.upstreamRateMultiplier) * Number(run.distributionMultiplier);
    return {
      samples,
      succeededCount: samples.filter((sample) => sample.status !== "failed" && sample.status !== "settlement_timeout")
        .length,
      acceptedCount: accepted.length,
      discardedCount,
      warmupRequestCount: warmups.length,
      warmupCacheCreationTokens: warmups.reduce((sum, item) => sum + item.cacheCreationTokens, 0) || undefined,
      warmupCacheReadTokens: warmups.reduce((sum, item) => sum + item.cacheReadTokens, 0) || undefined,
      warmupUsage: warmups.length ? { samples: warmups.map((item) => item.usage) } : undefined,
      upstreamBalanceBefore: averageProbeSampleValue(accepted, "upstreamBalanceBefore"),
      upstreamBalanceAfter: averageProbeSampleValue(accepted, "upstreamBalanceAfter"),
      upstreamBalanceDelta,
      localBalanceDelta,
      baseLocalCost,
      requestTokens: averageProbeSampleValue(accepted, "requestTokens"),
      responseTokens: averageProbeSampleValue(accepted, "responseTokens"),
      totalTokens: averageProbeSampleValue(accepted, "totalTokens"),
      cacheCreationTokens: averageProbeSampleValue(accepted, "cacheCreationTokens"),
      cacheReadTokens: averageProbeSampleValue(accepted, "cacheReadTokens"),
      suggestedMultiplier:
        calibrationStatus === "verified" ? averageProbeSampleValue(accepted, "suggestedMultiplier") : undefined,
      upstreamUsage: this.toAggregateUpstreamUsage(samples),
      costBreakdown,
      calibrationStatus,
      pricingSnapshot,
      pricingFingerprint: this.fingerprintPricingSnapshot(pricingSnapshot),
      balanceSnapshots: samples.flatMap((sample) => sample.balanceSnapshots ?? []),
    };
  }

  private async readBalanceSnapshot(
    workflow: RelayChannelProbeWorkflowStepDto[],
    variables: Record<string, string>,
  ): Promise<ProbeBalanceSnapshot> {
    let balance: number | undefined;
    for (const step of workflow) {
      const rawUrl = interpolateRequiredProbeVariables(step.url, variables) as string;
      const safe = await assertSafeOutboundUrl(rawUrl);
      const body = interpolateRequiredProbeVariables(step.body || {}, variables);
      const headers = getProbeWorkflowHeaders(
        step.method,
        interpolateRequiredProbeVariables(step.headers || {}, variables) as Record<string, string>,
      );
      const response = await axios.request({
        method: step.method,
        url: safe.url.toString(),
        headers,
        params: interpolateRequiredProbeVariables(step.query || {}, variables),
        data: getProbeWorkflowRequestBody(step.method, body),
        httpAgent: safe.httpAgent,
        httpsAgent: safe.httpsAgent,
        // A probe must use the validated and DNS-pinned target directly. Letting
        // Axios inherit HTTP(S)_PROXY bypasses that boundary and can turn a bad
        // deployment proxy into an opaque "Invalid IP address" probe failure.
        proxy: false,
        timeout: PROBE_TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: MAX_RESPONSE_BYTES,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      for (const [name, path] of Object.entries(step.extract || {})) {
        const value = readProbeJsonPath(response.data, path);
        if (value == null) throw new BadRequestError(`探针变量 ${name} 未在上游响应中找到`);
        variables[name] = String(value);
      }
      if (step.balancePath) {
        balance = toNumber(readProbeJsonPath(response.data, step.balancePath));
        if (balance === undefined) throw new BadRequestError("上游余额字段不是有效数值");
      }
    }
    if (balance === undefined) throw new BadRequestError("余额工作流未返回余额");
    return { balance, observedAt: new Date().toISOString() };
  }

  private async readSettledBalance(
    workflow: RelayChannelProbeWorkflowStepDto[],
    variables: Record<string, string>,
    tolerance: number,
    stableReadCount: number,
    baseline?: number,
  ): Promise<{ balance: number; snapshots: ProbeBalanceSnapshot[] }> {
    const normalizedTolerance = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0.000001;
    const requiredReads = Math.max(2, Math.floor(stableReadCount || 2));
    const snapshots: ProbeBalanceSnapshot[] = [];
    const deadline = Date.now() + PROBE_BALANCE_SETTLEMENT_TIMEOUT_MS;
    let stableReads = 0;
    let previous: ProbeBalanceSnapshot | undefined;
    while (Date.now() <= deadline) {
      const snapshot = await this.readBalanceSnapshot(workflow, { ...variables });
      snapshots.push(snapshot);
      const chargeObserved = baseline == null || snapshot.balance < baseline - normalizedTolerance;
      stableReads =
        chargeObserved && previous && Math.abs(snapshot.balance - previous.balance) <= normalizedTolerance
          ? stableReads + 1
          : 1;
      if (chargeObserved && stableReads >= requiredReads) return { balance: snapshot.balance, snapshots };
      previous = snapshot;
      await waitForProbeSettlement(PROBE_BALANCE_SETTLEMENT_POLL_MS);
    }
    throw new BadRequestError("PROBE_BALANCE_SETTLEMENT_TIMEOUT:上游余额在超时前未显示稳定扣费");
  }

  private async callUpstream(
    profile: ProbeProfileRecord,
    channel: RelayChannel,
    variables: Record<string, string>,
    upstreamModelId: string,
    cacheBustingEnabled: boolean,
    forceWithoutCacheBuster: boolean,
    cacheBusterId?: string,
    configuredEndpoint?: RelayChannelProbeEndpoint,
  ): Promise<{ response: Record<string, unknown>; cacheBusterId?: string; measurementInputInjected: boolean }> {
    const format = profile.probeFormat as "openai" | "anthropic" | "gemini";
    const endpoint = normalizeProbeEndpoint(configuredEndpoint ?? profile.probeEndpoint, format);
    assertProbeEndpointCompatibility(endpoint, format);
    const upstreamUrl =
      format === "anthropic"
        ? channel.anthropicUpstreamUrl
        : format === "gemini"
          ? channel.geminiUpstreamUrl
          : channel.openaiUpstreamUrl;
    const apiKey =
      format === "anthropic"
        ? channel.anthropicUpstreamApiKey
        : format === "gemini"
          ? channel.geminiUpstreamApiKey
          : channel.openaiUpstreamApiKey;
    if (!upstreamUrl || !apiKey) throw new BadRequestError("渠道缺少对应格式的上游配置");
    const base = await assertSafeOutboundUrl(upstreamUrl);
    const interpolatedPayload = interpolateRequiredProbeVariables(
      { ...(profile.probePayload as Record<string, unknown>), model: upstreamModelId },
      variables,
    );
    if (!isRecord(interpolatedPayload)) throw new BadRequestError("探针请求体必须是 JSON 对象");
    let payload = interpolatedPayload;
    // Earlier profiles were initialized with {}, which cannot safely carry a cache marker.
    // Preserve every configured field, but turn that exact empty legacy shape into the same
    // minimal request the UI now starts with.
    if (Object.keys(payload).every((key) => key === "model")) {
      payload = { ...payload, ...createDefaultProbePayload(format, endpoint) };
    }
    const measured = injectProbeMeasurementInput(payload, format, profile.measurementInputTokens, endpoint);
    const measurementInputInjected = measured != null;
    if (measured) payload = measured;
    let injectedCacheBusterId: string | undefined;
    if (cacheBustingEnabled) {
      const candidateId = cacheBusterId ?? randomUUID();
      const injected = injectProbeCacheBuster(payload, format, candidateId, endpoint);
      if (injected) {
        payload = injected;
        injectedCacheBusterId = candidateId;
      } else if (!forceWithoutCacheBuster) {
        throw new BadRequestError(
          "PROBE_CACHE_BUSTER_INJECTION_FAILED:当前请求体不包含该接口可注入的提示字段，请应用最小请求预设或修正请求格式",
        );
      }
    }
    const headers: Record<string, string> =
      format === "anthropic"
        ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${apiKey}` };
    const endpointUrl = new URL(buildProbeUpstreamEndpoint(base.url.toString(), format, upstreamModelId, endpoint));
    if (format === "gemini") endpointUrl.searchParams.set("key", apiKey);
    const response = await axios.post(endpointUrl.toString(), payload, {
      headers,
      httpAgent: base.httpAgent,
      httpsAgent: base.httpsAgent,
      proxy: false,
      timeout: PROBE_TIMEOUT_MS,
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    if (!isRecord(response.data)) throw new BadRequestError("上游模型响应必须是 JSON 对象");
    return { response: response.data, cacheBusterId: injectedCacheBusterId, measurementInputInjected };
  }

  private extractUsage(response: Record<string, unknown>) {
    const usage = isRecord(response.usage)
      ? response.usage
      : isRecord(response.usageMetadata)
        ? response.usageMetadata
        : {};
    const metrics = extractTokenUsageMetrics(usage);
    const hasExplicitInputTokens =
      hasTokenValue(usage.prompt_tokens) || hasTokenValue(usage.input_tokens) || hasTokenValue(usage.promptTokenCount);
    const normalized = normalizeTokenBreakdown(
      metrics.inputTokens,
      metrics.outputTokens,
      metrics.totalTokens,
      hasExplicitInputTokens ? 0 : 0,
    );
    return {
      requestTokens: normalized.requestTokens,
      responseTokens: normalized.responseTokens,
      totalTokens: normalized.totalTokens,
      cacheCreationTokens: metrics.cacheCreationTokens,
      cacheReadTokens: metrics.cacheReadTokens,
      upstreamUsage: usage,
    };
  }

  /**
   * A one-sample run should expose precisely the object the provider returned.
   * Multi-sample runs retain every successful raw usage object with only the
   * sample index added outside that object, so diagnostics never alter usage.
   */
  private toAggregateUpstreamUsage(
    samples: readonly RelayChannelProbeSampleDto[],
  ): Record<string, unknown> | undefined {
    const measured = samples.filter(
      (sample): sample is RelayChannelProbeSampleDto & { upstreamUsage: Record<string, unknown> } =>
        sample.upstreamUsage != null,
    );
    if (measured.length === 0) return undefined;
    if (measured.length === 1) return measured[0].upstreamUsage;
    return {
      samples: measured.map((sample) => ({ index: sample.index, usage: sample.upstreamUsage })),
    };
  }

  private async calculateBaseCost(
    profile: ProbeProfileRecord,
    usage: {
      requestTokens: number;
      responseTokens: number;
      totalTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
    },
    rate: ModelPricingItemDto,
  ): Promise<{ baseCost: number; breakdown: RelayChannelProbeCostBreakdownDto }> {
    const relayConfig = await RelayConfigService.getInstance().getRelayConfig();
    const timeMultiplier = computeMultiplierForTime(
      (profile.relayChannel.timePeriodMultipliers as any[]) || [],
      new Date(),
    );
    const globalMultiplier = Number(relayConfig.globalMultiplier);
    const contextMatch = resolveContextLengthMultiplier(
      profile.relayChannel.contextLengthMultipliers as unknown as ContextLengthMultiplierRule[] | undefined,
      usage.requestTokens + usage.cacheCreationTokens + usage.cacheReadTokens,
    );
    const multiplier = globalMultiplier * timeMultiplier * contextMatch.multiplier;
    const cacheCreationMultiplier = Number(rate.cacheCreationMultiplier ?? DEFAULT_CACHE_CREATION_MULTIPLIER);
    const cacheReadMultiplier = Number(rate.cacheReadMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER);
    if (rate.pricingType === "per-request") {
      const fixedPrice = Number(rate.fixedPrice || 0);
      const rawCost = fixedPrice * multiplier;
      return {
        baseCost: Number.isFinite(rawCost) ? Math.max(0, Math.ceil(rawCost * 10_000) / 10_000) : 0,
        breakdown: {
          pricingType: "per-request",
          fixedPrice,
          inputRate: 0,
          outputRate: 0,
          billableInputTokens: 0,
          cacheCreationMultiplier,
          cacheReadMultiplier,
          globalMultiplier,
          timeMultiplier,
          contextMultiplier: contextMatch.multiplier,
          contextTokens: contextMatch.contextTokens,
          contextRuleName: contextMatch.ruleName,
          rawCost: Number.isFinite(rawCost) ? rawCost : 0,
        },
      };
    }

    const inputRate = Number(rate.inputPrice || 0) / TOKEN_PRICE_DIVISOR;
    const outputRate = Number(rate.outputPrice || 0) / TOKEN_PRICE_DIVISOR;
    const billableInputTokens =
      profile.relayChannel.inputTokensIncludeCacheRead === true
        ? Math.max(0, usage.requestTokens - usage.cacheReadTokens)
        : usage.requestTokens;
    const rawCost =
      (billableInputTokens * inputRate +
        usage.cacheCreationTokens * inputRate * cacheCreationMultiplier +
        usage.cacheReadTokens * inputRate * cacheReadMultiplier +
        usage.responseTokens * outputRate) *
      multiplier;
    return {
      baseCost: Number.isFinite(rawCost) ? Math.max(0, Math.ceil(rawCost * 10_000) / 10_000) : 0,
      breakdown: {
        pricingType: "token-based",
        inputRate,
        outputRate,
        billableInputTokens,
        cacheCreationMultiplier,
        cacheReadMultiplier,
        globalMultiplier,
        timeMultiplier,
        contextMultiplier: contextMatch.multiplier,
        contextTokens: contextMatch.contextTokens,
        contextRuleName: contextMatch.ruleName,
        rawCost: Number.isFinite(rawCost) ? rawCost : 0,
      },
    };
  }

  private async resolveProbeModelPricing(profile: ProbeProfileRecord) {
    const relayConfig = await RelayConfigService.getInstance().getRelayConfig();
    return resolveProbeModelPricing(
      profile.probeModel,
      profile.relayChannel.modelMapping as Record<string, string> | null | undefined,
      relayConfig.modelRates,
    );
  }

  private async createPricingSnapshot(
    profile: ProbeProfileRecord,
    rate: ModelPricingItemDto,
  ): Promise<Record<string, unknown>> {
    const relayConfig = await RelayConfigService.getInstance().getRelayConfig();
    return {
      model: profile.probeModel,
      modelMapping: profile.relayChannel.modelMapping ?? {},
      rate,
      globalMultiplier: relayConfig.globalMultiplier,
      timeMultiplier: computeMultiplierForTime((profile.relayChannel.timePeriodMultipliers as any[]) || [], new Date()),
      timePeriodMultipliers: profile.relayChannel.timePeriodMultipliers ?? [],
      contextLengthMultipliers: profile.relayChannel.contextLengthMultipliers ?? [],
      inputTokensIncludeCacheRead: profile.relayChannel.inputTokensIncludeCacheRead === true,
      cacheMode: profile.cacheMode,
      endpoint: profile.probeEndpoint,
    };
  }

  private fingerprintPricingSnapshot(snapshot: Record<string, unknown>): string {
    return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  }

  private getEncryptionKey(): Buffer {
    const secret = env.relay.channelProbe.masterKey;
    if (secret.length < 64) throw new BadRequestError("渠道探针主密钥未配置");
    return createHash("sha256").update(secret).digest();
  }
  private encryptCredentials(credentials: Record<string, unknown>) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.getEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]).toString(
      "base64",
    );
    return { ciphertext, iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
  }
  private decryptCredentials(profile: ProbeProfileRecord): Record<string, unknown> {
    if (!profile.encryptedCredentials || !profile.credentialIv || !profile.credentialAuthTag)
      throw new BadRequestError("渠道探针凭据未配置");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.getEncryptionKey(),
      Buffer.from(profile.credentialIv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(profile.credentialAuthTag, "base64"));
    const parsed: unknown = JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(profile.encryptedCredentials, "base64")), decipher.final()]).toString(
        "utf8",
      ),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new BadRequestError("渠道探针凭据格式无效");
    return parsed as Record<string, unknown>;
  }

  private resolveProbeExecutionChannel(profile: ProbeProfileRecord, sampleIndex: number) {
    if (profile.relayChannel.channelType !== "pooled") return profile.relayChannel;
    const members = (
      (profile.relayChannel as RelayChannel & { pooledChildren?: RelayChannel[] }).pooledChildren ?? []
    ).filter(
      (member) =>
        member.channelType === "pooled-member" &&
        member.status === RELAY_CHANNEL_STATUS.ENABLED &&
        member.pooledMemberEnabled !== false,
    );
    if (!members.length) throw new BadRequestError("逻辑混池没有可用的物理成员用于探针");
    return members[sampleIndex % members.length]!;
  }

  private resolveProbeVariables(profile: ProbeProfileRecord, memberId: string): Record<string, string> {
    const credentials = this.decryptCredentials(profile);
    const candidate = profile.relayChannel.channelType === "pooled" ? credentials[memberId] : credentials;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new BadRequestError("逻辑混池缺少当前物理成员的探针凭据");
    const variables = Object.entries(candidate).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    if (variables.length !== Object.keys(candidate).length) throw new BadRequestError("渠道探针凭据格式无效");
    return Object.fromEntries(variables);
  }
  private toProfileDto(profile: any): RelayChannelProbeProfileDto {
    return {
      id: profile.id,
      relayChannelId: profile.relayChannelId,
      enabled: profile.enabled,
      probeFormat: profile.probeFormat,
      probeEndpoint: normalizeProbeEndpoint(profile.probeEndpoint, profile.probeFormat as ProbeFormat),
      probeModel: profile.probeModel,
      probePayload: profile.probePayload as Record<string, unknown>,
      preventCache: profile.preventCache,
      cacheMode: profile.cacheMode as RelayChannelProbeCacheMode,
      sampleCount: profile.sampleCount,
      strictCalibrationValidation: profile.strictCalibrationValidation,
      measurementInputTokens: profile.measurementInputTokens,
      balanceSettlementTolerance: Number(profile.balanceSettlementTolerance),
      balanceSettlementReads: profile.balanceSettlementReads,
      upstreamCurrency: profile.upstreamCurrency,
      localCurrency: profile.localCurrency,
      upstreamBalanceDivisor: Number(profile.upstreamBalanceDivisor),
      upstreamRateMultiplier: Number(profile.upstreamRateMultiplier),
      probeGroup: profile.probeGroup || undefined,
      distributionMultiplier: Number(profile.distributionMultiplier),
      workflow: profile.workflow as RelayChannelProbeWorkflowStepDto[],
      credentialNames: profile.encryptedCredentials ? Object.keys(this.decryptCredentials(profile)) : [],
      createTime: profile.createTime,
      updateTime: profile.updateTime,
    };
  }
  private toRunDto(run: ProbeRunRecord): RelayChannelProbeRunDto {
    const n = (value: Prisma.Decimal | null) => (value == null ? undefined : Number(value));
    return {
      id: run.id,
      relayChannelId: run.relayChannelId,
      profileId: run.profileId || undefined,
      status: run.status as RelayChannelProbeRunDto["status"],
      queuedAt: run.queuedAt,
      startedAt: run.startedAt || undefined,
      finishedAt: run.finishedAt || undefined,
      distributionMultiplier: Number(run.distributionMultiplier),
      probeEndpoint: run.probeEndpoint as RelayChannelProbeEndpoint,
      cacheMode: run.cacheMode as RelayChannelProbeCacheMode,
      sampleCount: run.sampleCount,
      strictCalibrationValidation: run.strictCalibrationValidation,
      measurementInputTokens: run.measurementInputTokens,
      balanceSettlementTolerance: Number(run.balanceSettlementTolerance),
      balanceSettlementReads: run.balanceSettlementReads,
      sampleSucceededCount: run.sampleSucceededCount,
      sampleAcceptedCount: run.sampleAcceptedCount,
      sampleDiscardedCount: run.sampleDiscardedCount,
      warmupRequestCount: run.warmupRequestCount,
      warmupCacheCreationTokens: run.warmupCacheCreationTokens ?? undefined,
      warmupCacheReadTokens: run.warmupCacheReadTokens ?? undefined,
      warmupUsage: (run.warmupUsage as Record<string, unknown> | null) ?? undefined,
      samples: (run.samples as RelayChannelProbeSampleDto[] | null) ?? undefined,
      upstreamBalanceBefore: n(run.upstreamBalanceBefore),
      upstreamBalanceAfter: n(run.upstreamBalanceAfter),
      upstreamBalanceDelta: n(run.upstreamBalanceDelta),
      upstreamRateMultiplier: Number(run.upstreamRateMultiplier),
      localBalanceBefore: n(run.localBalanceBefore),
      localBalanceAfter: n(run.localBalanceAfter),
      localBalanceDelta: n(run.localBalanceDelta),
      baseLocalCost: n(run.baseLocalCost),
      requestTokens: run.requestTokens ?? undefined,
      responseTokens: run.responseTokens ?? undefined,
      totalTokens: run.totalTokens ?? undefined,
      cacheCreationTokens: run.cacheCreationTokens ?? undefined,
      cacheReadTokens: run.cacheReadTokens ?? undefined,
      cacheBustingEnabled: run.cacheBustingEnabled,
      forceWithoutCacheBuster: run.forceWithoutCacheBuster,
      calibrationStatus: run.calibrationStatus as RelayChannelProbeRunDto["calibrationStatus"],
      pricingFingerprint: run.pricingFingerprint || undefined,
      pricingSnapshot: (run.pricingSnapshot as Record<string, unknown> | null) ?? undefined,
      balanceSnapshots: (run.balanceSnapshots as RelayChannelProbeRunDto["balanceSnapshots"] | null) ?? undefined,
      cacheBusterId: run.cacheBusterId ?? undefined,
      upstreamUsage: (run.upstreamUsage as Record<string, unknown> | null) ?? undefined,
      costBreakdown: (run.costBreakdown as RelayChannelProbeCostBreakdownDto | null) ?? undefined,
      suggestedMultiplier: n(run.suggestedMultiplier),
      sourceChannelMultiplier: n(run.sourceChannelMultiplier),
      appliedMultiplier: n(run.appliedMultiplier),
      appliedAt: run.appliedAt || undefined,
      errorMessage: run.errorMessage || undefined,
      requestedByUserId: run.requestedByUserId,
      createTime: run.createTime,
      updateTime: run.updateTime,
    };
  }
  private safeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      if (error.response)
        return formatProbeUpstreamError(error.response.status, error.config?.url, error.response.data);
      return normalizeProbeNetworkError(redactProbeErrorText(error.message) || "上游请求失败");
    }
    const message = error instanceof Error ? error.message : "探针执行失败";
    return normalizeProbeNetworkError(redactProbeErrorText(message) || "探针执行失败");
  }

  private async runProbePhase<T>(phase: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new Error(`${phase}失败：${this.safeError(error)}`);
    }
  }

  private normalizeProbeGroup(value: string | undefined): string | null {
    const group = value?.trim();
    return group || null;
  }

  private toAllowedProbeFormats(value: string): Array<"openai" | "anthropic" | "gemini"> {
    return resolveAllowedProbeFormats(value);
  }

  private getProbeGroupLockId(group: string): string {
    const fingerprint = createHash("sha256").update(group.trim().toLocaleLowerCase()).digest("hex").slice(0, 32);
    return `probe-group:${fingerprint}`;
  }

  private assertProbeChannelCompatibility(
    channel: Awaited<ReturnType<RelayChannelService["getChannel"]>>,
    format: string,
    model: string,
  ): void {
    if (!supportsRelayRequestFormat(channel.allowedFormats, format as RelayRequestFormat))
      throw new BadRequestError(`渠道不支持 ${format} 格式探针请求`);

    if (channel.allowedModels.length && !channel.allowedModels.includes(model))
      throw new BadRequestError(`渠道不支持探针模型 ${model}，请从渠道已配置模型中选择`);

    const upstreamConfigured =
      format === "openai"
        ? Boolean(channel.openaiUpstreamUrl && channel.hasOpenaiUpstreamApiKey)
        : format === "anthropic"
          ? Boolean(channel.anthropicUpstreamUrl && channel.hasAnthropicUpstreamApiKey)
          : Boolean(channel.geminiUpstreamUrl && channel.hasGeminiUpstreamApiKey);
    if (!upstreamConfigured) throw new BadRequestError(`渠道缺少 ${format} 格式的上游地址或凭据`);
  }

  private async cleanupExpiredRuns(): Promise<void> {
    if (Date.now() - this.lastCleanupAt < 60 * 60 * 1000) return;
    this.lastCleanupAt = Date.now();
    await this.repository.deleteRunsBefore(new Date(Date.now() - RUN_RETENTION_MS));
  }

  private getRunQueueSlotKey(channelId: string): string {
    return `${RUN_QUEUE_SLOT_PREFIX}:${channelId}`;
  }
}
