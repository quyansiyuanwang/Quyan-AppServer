/** Versioned per-process AI memory budgets. Byte capacities use 1024-based units. */
export interface AIResourceSettingsDto {
  version: 1;
  aiResources: {
    maxActiveRequests: number;
    maxQueuedRequests: number;
    queueTimeoutMs: number;
    memory: { sampleIntervalMs: number; highWatermarkBytes: number; resumeWatermarkBytes: number };
    streaming: { frameLimitBytes: number; retainedLimitBytes: number; maxBlocks: number; outputLimitBytes: number };
    http: {
      maxSockets: number;
      maxTotalSockets: number;
      maxFreeSockets: number;
      /** TCP keep-alive initial delay in milliseconds. */
      keepAliveMsecs: number;
      /** Upstream socket inactivity timeout in milliseconds. */
      socketTimeoutMs: number;
    };
  };
  chat: {
    resourceLimits: {
      inputLimitBytes: number;
      outputLimitBytes: number;
      contextMaxMessages: number;
      contextLimitBytes: number;
    };
  };
  aiRequestLog: {
    requestBodyBytes: number;
    responseBodyBytes: number;
    writeConcurrency: number;
    queueMaxItems: number;
    queueMaxBytes: number;
  };
  relay: {
    resourceGuard: {
      /** Relay JSON request capacity in MiB; does not change non-relay routes. */
      jsonBodyLimitMb: number;
      /** Downstream response inactivity timeout in milliseconds. */
      downstreamIdleTimeoutMs: number;
      multipartBodyLimitMb: number;
      imageMaxConcurrency: number;
      imageQueueTimeoutMs: number;
      nonStreamUpstreamTimeoutMs: number;
      maxUpstreamResponseBodyMb: number;
      imageResponseBodyLimitMb: number;
    };
    channelProbe: { maxConcurrency: number };
  };
  ruleCache: { maxItems: number; maxEstimatedBytes: number };
}
export interface AIResourceFieldDto {
  path: string;
  group: string;
  label: string;
  labelEn: string;
  unit: string;
  scale: number;
  min: number;
  max: number;
}
export interface AIResourceConfigurationDto {
  configKey: string;
  effective: AIResourceSettingsDto;
  defaults: AIResourceSettingsDto;
  fields: AIResourceFieldDto[];
  source: "defaults" | "legacy-env" | "database";
  revision: string;
  legacyEnvironmentPresent: boolean;
}
