import {
  normalizeRelayTokenModelMappingRules,
  selectRelayTokenModelMappingRule,
  type RelayTokenModelMappingRule,
} from "@quyan/shared";
import { resolveMappedModel } from "@/util/model-mapping.util";
import { isModelNameAllowed, resolveModelId } from "@/util/model-resolution.util";
import {
  parseRelayChannelAllowedModelNames,
  parseRelayTokenAllowedModelIds,
  supportsRelayRequestFormat,
  type RelayChannelAccessLike,
  type RelayModelFormatLike,
  type RelayRequestFormat,
} from "@/util/relay/relay-model-availability.util";
import { resolveRelayRequestFormatTransform } from "../relay-request-format-transform.service";
import type { RelayConvertibleRequestFormat } from "@quyan/shared";

/** Token-owned policy only. Resolving a route never writes to any token or channel. */
export interface RelayModelRouteToken {
  id?: string;
  allowedModels?: string | null;
  modelMapping?: unknown;
  modelMappingRules?: unknown;
  requestFormatTransforms?: unknown;
  failoverConfig?: { maxAcceptedChannelMultiplier?: unknown } | null;
}
export interface RelayModelRouteChannel extends RelayChannelAccessLike {
  modelMapping?: unknown;
  multiplier?: unknown;
  routingChannelIds?: readonly string[];
}
export interface RelayModelRouteStep {
  tokenId?: string;
  inputModel: string;
  outputModel: string;
  sourceFormat: RelayRequestFormat;
  targetFormat: RelayRequestFormat;
  rule?: RelayTokenModelMappingRule;
  fallback: boolean;
}
export interface RelayModelRouteResult<TModel> {
  modelConfig: TModel | null;
  effectiveModel?: string;
  requestFormat: RelayRequestFormat;
  steps: RelayModelRouteStep[];
  outcome: "mapped" | "original" | "fallback" | "unavailable";
  reason: string;
}

/** Resolve one intact root-to-leaf path, applying each token's policy once. */
export function resolveRelayModelRoute<TModel extends RelayModelFormatLike>(input: {
  requestedModel: string;
  requestFormat: RelayRequestFormat;
  tokens: readonly RelayModelRouteToken[];
  channel: RelayModelRouteChannel;
  channelPathIds?: readonly string[];
  modelCatalog: readonly TModel[];
}): RelayModelRouteResult<TModel> {
  const { channel, modelCatalog, tokens } = input;
  const policies = tokens.map((token) => ({
    rules: normalizeRelayTokenModelMappingRules(token.modelMappingRules, token.modelMapping),
    allowed: parseRelayTokenAllowedModelIds(token.allowedModels),
  }));
  const pathIds = input.channelPathIds ?? channel.routingChannelIds ?? (channel.id ? [channel.id] : []);
  const allowedNames = parseRelayChannelAllowedModelNames(channel);
  const unavailable = (format: RelayRequestFormat, reason: string): RelayModelRouteResult<TModel> => ({
    modelConfig: null,
    requestFormat: format,
    steps: [],
    outcome: "unavailable",
    reason,
  });
  const select = (name: string, format: RelayRequestFormat, mapped: boolean): TModel | undefined => {
    if (!supportsRelayRequestFormat(channel.allowedFormats, format)) return undefined;
    const exact = modelCatalog.filter((row) => resolveModelId(row).trim() === name.trim());
    // Legacy mapping targets may be catalog labels. Request identities remain case-sensitive model IDs.
    const candidates = (
      exact.length || !mapped ? exact : modelCatalog.filter((row) => row.model?.trim() === name.trim())
    ).filter((row) => supportsRelayRequestFormat(row.supportedFormats, format));
    return allowedNames === null
      ? candidates[0]
      : (candidates.find((row) => isModelNameAllowed(allowedNames, row.model || "")) ??
          candidates.find((row) => isModelNameAllowed(allowedNames, resolveModelId(row))));
  };
  const cache = new Map<string, RelayModelRouteResult<TModel>>();
  const visit = (
    index: number,
    model: string,
    format: RelayRequestFormat,
    mapped: boolean,
  ): RelayModelRouteResult<TModel> => {
    const key = JSON.stringify([index, model, format, mapped]);
    const cached = cache.get(key);
    if (cached) return cached;
    if (index === tokens.length) {
      const config = select(model, format, mapped);
      const resolved: RelayModelRouteResult<TModel> = config
        ? {
            modelConfig: config,
            effectiveModel: resolveModelId(config),
            requestFormat: format,
            steps: [],
            outcome: "original",
            reason: "original",
          }
        : unavailable(
            format,
            supportsRelayRequestFormat(channel.allowedFormats, format) ? "model-unavailable" : "format-unsupported",
          );
      cache.set(key, resolved);
      return resolved;
    }
    const token = tokens[index]!;
    const targetFormat =
      resolveRelayRequestFormatTransform(token.requestFormatTransforms, format as RelayConvertibleRequestFormat)
        ?.targetFormat ?? format;
    const rule = selectRelayTokenModelMappingRule(model, policies[index]!.rules, pathIds);
    const original = () => {
      if (index < tokens.length - 1) return visit(index + 1, model, targetFormat, mapped);
      // Channel mappings are fallback policy, never a second rewrite of a token mapping target.
      const channelMapped = resolveMappedModel(model, channel.modelMapping as Record<string, string> | null);
      if (channelMapped !== model) {
        const result = visit(index + 1, channelMapped, targetFormat, true);
        if (result.modelConfig) return result;
      }
      return visit(index + 1, model, targetFormat, mapped);
    };
    let result: RelayModelRouteResult<TModel>;
    let outputModel = model;
    let fallback = false;
    if (!rule) result = original();
    else if (rule.preference === "original-first") {
      result = original();
      if (!result.modelConfig) {
        const preferred = result;
        outputModel = rule.target;
        result = visit(index + 1, rule.target, targetFormat, true);
        if (!result.modelConfig && ["model-not-allowed", "multiplier-exceeded"].includes(preferred.reason)) {
          outputModel = model;
          result = preferred;
        }
      }
    } else {
      outputModel = rule.target;
      result = visit(index + 1, rule.target, targetFormat, true);
      if (!result.modelConfig) {
        const preferred = result;
        fallback = true;
        outputModel = model;
        result = original();
        if (!result.modelConfig && ["model-not-allowed", "multiplier-exceeded"].includes(preferred.reason)) {
          outputModel = rule.target;
          fallback = false;
          result = preferred;
        }
      }
    }
    let resolved: RelayModelRouteResult<TModel> = {
      ...result,
      steps: [
        {
          tokenId: token.id,
          inputModel: model,
          outputModel,
          sourceFormat: format,
          targetFormat,
          ...(rule ? { rule } : {}),
          fallback,
        },
        ...result.steps,
      ],
    };
    if (resolved.modelConfig) {
      const maximum = token.failoverConfig?.maxAcceptedChannelMultiplier;
      const allowed = policies[index]!.allowed;
      const identities = [model, outputModel];
      // A leaf also accepts the physical identity selected by its own channel mapping.
      if (index === tokens.length - 1) identities.push(resolved.effectiveModel!);
      if (maximum != null && Number(channel.multiplier) > Number(maximum))
        resolved = { ...resolved, modelConfig: null, outcome: "unavailable", reason: "multiplier-exceeded" };
      else if (
        allowed.length &&
        !identities.some(
          (name) =>
            allowed.includes(name) ||
            (resolved.modelConfig?.model?.trim() === name.trim() && allowed.includes(resolved.effectiveModel!)),
        )
      )
        resolved = { ...resolved, modelConfig: null, outcome: "unavailable", reason: "model-not-allowed" };
    }
    // Parent preferences may fall back when a member denies a target; the member's
    // own whitelist never changes its selected preference or grants another path's identity.
    cache.set(key, resolved);
    return resolved;
  };
  const result = visit(0, input.requestedModel.trim(), input.requestFormat, false);
  if (!result.modelConfig) return result;
  const fallback = result.steps.some((step) => step.fallback);
  const changed = result.effectiveModel !== input.requestedModel.trim();
  return {
    ...result,
    outcome: fallback ? "fallback" : changed ? "mapped" : "original",
    reason: fallback ? "fallback" : changed ? "mapped" : "original",
  };
}

/** Finite discovery seeds. Wildcards describe rules, rather than inventing concrete upstream IDs. */
export function relayModelRouteRequestCandidates(
  tokens: readonly RelayModelRouteToken[],
  channels: readonly RelayModelRouteChannel[],
  modelCatalog: readonly RelayModelFormatLike[],
): string[] {
  const candidates = new Set<string>();
  for (const channel of channels) {
    const names = parseRelayChannelAllowedModelNames(channel);
    if (names !== null)
      for (const model of modelCatalog)
        if (isModelNameAllowed(names, model.model || "") || isModelNameAllowed(names, resolveModelId(model)))
          candidates.add(resolveModelId(model));
    if (channel.modelMapping && typeof channel.modelMapping === "object" && !Array.isArray(channel.modelMapping))
      for (const name of Object.keys(channel.modelMapping)) candidates.add(name);
  }
  for (const token of tokens) {
    for (const rule of normalizeRelayTokenModelMappingRules(token.modelMappingRules, token.modelMapping)) {
      if (!/[?*]/.test(rule.source)) candidates.add(rule.source);
      // A configured target is a finite discovery seed even when its channel is unrestricted.
      // Publish its request identity, then let the caller prove this route can serve it.
      const exact = modelCatalog.filter((model) => resolveModelId(model).trim() === rule.target.trim());
      const targets = exact.length ? exact : modelCatalog.filter((model) => model.model?.trim() === rule.target.trim());
      for (const model of targets) candidates.add(resolveModelId(model));
    }
    for (const name of parseRelayTokenAllowedModelIds(token.allowedModels))
      if (!/[?*]/.test(name)) candidates.add(name);
  }
  return [...candidates].filter(Boolean).sort((a, b) => a.localeCompare(b));
}
