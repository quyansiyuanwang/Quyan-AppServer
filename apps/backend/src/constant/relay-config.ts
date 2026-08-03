export const DEFAULT_RELAY_CONFIG = {
  globalMultiplier: 1.0,
  maxConcurrency: 3, // Balanced for 2v2g servers - allows some concurrency without overwhelming CPU
  queueTimeout: 300000, // 5 minutes for image generation
  upstreamStreamTimeout: 120000,
  enableQueue: true,
  // Publish a logical channel with a model-level price range, never its pool topology.
  apiCatalogPoolVisibility: "anonymous-range" as const,
  channelTopologyMode: "legacy" as const,
} as const;
