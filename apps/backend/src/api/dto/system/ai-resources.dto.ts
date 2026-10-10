/** Versioned per-process AI memory budgets. Byte capacities use 1024-based units. */
export interface AIResourceSettingsDto {
  version: 1;
  aiResources: {
    maxActiveRequests: number;
    maxQueuedRequests: number;
    queueTimeoutMs: number;
    memory: { sampleIntervalMs: number; highWatermarkBytes: number; resumeWatermarkBytes: number };
    streaming: { frameLimitBytes: number; retainedLimitBytes: number; maxBlocks: number; outputLimitBytes: number };
    http: { maxSockets: number; maxTotalSockets: number; maxFreeSockets: number };
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
