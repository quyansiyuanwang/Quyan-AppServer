import { getAIResourceConfig } from "@/services/infrastructure/ai-resource-config.service";
import { DEFAULT_RELAY_CONFIG } from "@/constant/relay-config";
import {
  GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID,
  GLOBAL_CONCURRENCY_STATUS_USER_ID,
} from "@/services/relay/utils/relay-concurrency.constants";
import type {
  RelayConfigDto,
  RelayConcurrencyStatusItemDto,
  RelayConcurrencyStatusTotalsDto,
} from "@/api/dto/relay/relay-config.dto";
export const isRelayConcurrencySubjectId = (id: unknown): id is string =>
  typeof id === "string" && id.trim() === id && /^[A-Za-z0-9_-]{1,191}$/.test(id);
export interface RelayConcurrencyKeyTarget {
  key: string;
  baseKey: string;
  scope: "default" | "image";
  userId: string;
  kind: "slot" | "waiter";
}
export function relayConcurrencyKeyTarget(key: string): RelayConcurrencyKeyTarget | undefined {
  const match = /^relay:concurrency:(default|image):([A-Za-z0-9_-]{1,191}):(slot|queue:waiter):([0-9]+)$/.exec(key);
  if (!match || match[0] !== key || (match[1] === "image" && match[2] !== GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID)) return;
  return {
    key,
    baseKey: `relay:concurrency:${match[1]}:${match[2]}`,
    scope: match[1] as "default" | "image",
    userId: match[1] === "image" ? GLOBAL_CONCURRENCY_STATUS_USER_ID : match[2]!,
    kind: match[3] === "slot" ? "slot" : "waiter",
  };
}
export function projectRelayConcurrencyLimits(
  config?: Pick<RelayConfigDto, "maxConcurrency" | "queueTimeout" | "enableQueue" | "upstreamStreamTimeout"> | null,
) {
  const value = config ?? DEFAULT_RELAY_CONFIG,
    guard = getAIResourceConfig().relay.resourceGuard;
  return {
    maxConcurrency: value.maxConcurrency,
    effectiveImageMaxConcurrency: Math.min(value.maxConcurrency, guard.imageMaxConcurrency),
    imageMaxConcurrencyCap: guard.imageMaxConcurrency,
    enableQueue: value.enableQueue,
    queueTimeoutMs: value.queueTimeout,
    effectiveImageQueueTimeoutMs: Math.min(value.queueTimeout, guard.imageQueueTimeoutMs),
    imageQueueTimeoutMs: guard.imageQueueTimeoutMs,
    upstreamStreamTimeoutMs: value.upstreamStreamTimeout,
    nonStreamUpstreamTimeoutMs: guard.nonStreamUpstreamTimeoutMs,
  };
}
export function projectRelayConcurrencyTotals(
  items: readonly RelayConcurrencyStatusItemDto[],
): RelayConcurrencyStatusTotalsDto {
  const users = new Set<string>();
  const totals = { activeCount: 0, defaultScopeActiveCount: 0, imageScopeActiveCount: 0, queuedCount: 0, userCount: 0 };
  for (const item of items) {
    totals.activeCount += item.activeCount;
    totals.queuedCount += item.queueLength;
    if (item.scope === "image") totals.imageScopeActiveCount += item.activeCount;
    else totals.defaultScopeActiveCount += item.activeCount;
    if (item.userId !== GLOBAL_CONCURRENCY_STATUS_USER_ID) users.add(item.userId);
  }
  return { ...totals, userCount: users.size };
}
