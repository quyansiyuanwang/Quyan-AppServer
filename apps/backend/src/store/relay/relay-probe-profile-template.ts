import type { Prisma } from "@prisma/client";
/** Shareable settings only. Credentials and account bindings are intentionally excluded. */
export const relayProbeProfileTemplateSelect = {
  enabled: true,
  probeFormat: true,
  probeEndpoint: true,
  probeModel: true,
  probePayload: true,
  preventCache: true,
  cacheMode: true,
  sampleCount: true,
  strictCalibrationValidation: true,
  measurementInputTokens: true,
  balanceSettlementTolerance: true,
  balanceSettlementReads: true,
  upstreamCurrency: true,
  localCurrency: true,
  upstreamBalanceDivisor: true,
  upstreamRateMultiplier: true,
  probeGroup: true,
  distributionMultiplier: true,
  workflow: true,
} as const satisfies Prisma.RelayChannelProbeProfileSelect;
export type RelayProbeProfileTemplate = Prisma.RelayChannelProbeProfileGetPayload<{
  select: typeof relayProbeProfileTemplateSelect;
}>;
export function copyProbeProfileSettings(source: RelayProbeProfileTemplate) {
  return {
    enabled: source.enabled,
    probeFormat: source.probeFormat,
    probeEndpoint: source.probeEndpoint,
    probeModel: source.probeModel,
    probePayload: source.probePayload as Prisma.InputJsonValue,
    preventCache: source.preventCache,
    cacheMode: source.cacheMode,
    sampleCount: source.sampleCount,
    strictCalibrationValidation: source.strictCalibrationValidation,
    measurementInputTokens: source.measurementInputTokens,
    balanceSettlementTolerance: source.balanceSettlementTolerance,
    balanceSettlementReads: source.balanceSettlementReads,
    upstreamCurrency: source.upstreamCurrency,
    localCurrency: source.localCurrency,
    upstreamBalanceDivisor: source.upstreamBalanceDivisor,
    upstreamRateMultiplier: source.upstreamRateMultiplier,
    probeGroup: source.probeGroup,
    distributionMultiplier: source.distributionMultiplier,
    workflow: source.workflow as Prisma.InputJsonValue,
  };
}
