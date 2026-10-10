import { env } from "@/config/env";
import { AIResourceConfigService } from "@/services/infrastructure/ai-resource-config.service";
/** Publish legacy test overrides through the production dynamic-config boundary. */
export function publishTestAIResources() {
  const service = AIResourceConfigService.getInstance();
  service.apply({
    ...structuredClone(service.current),
    aiResources: structuredClone(env.aiResources),
    chat: structuredClone(env.chat),
    aiRequestLog: structuredClone(env.aiRequestLog),
    relay: {
      resourceGuard: structuredClone(env.relay.resourceGuard),
      channelProbe: { maxConcurrency: env.relay.channelProbe.maxConcurrency },
    },
  });
}
