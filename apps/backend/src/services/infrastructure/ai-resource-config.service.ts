import { env } from "@/config/env";
import { deepFreeze } from "@/config/env/common";
import {
  AI_RESOURCE_CONFIG_KEY,
  AI_RESOURCE_DEFAULTS,
  AI_RESOURCE_FIELDS,
  AI_RESOURCE_REFRESH_MS,
  aiResourceSettingsSchema,
} from "@/config/ai-resource-policy";
import type { AIResourceSettingsDto, AIResourceConfigurationDto } from "@/api/dto/system/ai-resources.dto";
import { ServerConfigRepository } from "@/store/system/server-config.repository";
import type { ServerConfigStore } from "@/store/system/server-config.store";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
const logger = getLogger("AIResourceConfiguration", LogCategory.SYSTEM);
let snapshotReader: (() => AIResourceSettingsDto | undefined) | undefined;
export function registerAIResourceSnapshotReader(reader: () => AIResourceSettingsDto | undefined) {
  snapshotReader = reader;
}
export function getAIResourceConfig(): AIResourceSettingsDto {
  return snapshotReader?.() ?? AIResourceConfigService.getInstance().current;
}
export function getCurrentAIResourceConfig(): AIResourceSettingsDto {
  return AIResourceConfigService.getInstance().current;
}
export class AIResourceConfigService {
  private static instance: AIResourceConfigService;
  static getInstance() {
    return (this.instance ??= new AIResourceConfigService());
  }
  current: AIResourceSettingsDto;
  private source: AIResourceConfigurationDto["source"];
  private revision = "bootstrap";
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private refreshing?: Promise<void>;
  private readonly listeners = new Set<() => void>();
  private readonly legacyPresent: boolean;
  constructor(private readonly repository: ServerConfigStore = ServerConfigRepository.getInstance()) {
    this.legacyPresent = Boolean(env.legacyAIResourceEnvironmentPresent);
    this.source = this.legacyPresent ? "legacy-env" : "defaults";
    this.current = deepFreeze({
      ...structuredClone(AI_RESOURCE_DEFAULTS),
      aiResources: structuredClone(env.aiResources ?? AI_RESOURCE_DEFAULTS.aiResources),
      chat: structuredClone(env.chat ?? AI_RESOURCE_DEFAULTS.chat),
      aiRequestLog: structuredClone(env.aiRequestLog ?? AI_RESOURCE_DEFAULTS.aiRequestLog),
      relay: {
        resourceGuard: structuredClone(env.relay?.resourceGuard ?? AI_RESOURCE_DEFAULTS.relay.resourceGuard),
        channelProbe: {
          maxConcurrency:
            env.relay?.channelProbe?.maxConcurrency ?? AI_RESOURCE_DEFAULTS.relay.channelProbe.maxConcurrency,
        },
      },
    });
  }
  parse(raw: string): AIResourceSettingsDto {
    try {
      return deepFreeze(aiResourceSettingsSchema.parse(JSON.parse(raw)));
    } catch {
      throw new BadRequestError("Invalid AI resource configuration", undefined, {
        messageKey: "system.invalidAiResources",
      });
    }
  }
  describe(): AIResourceConfigurationDto {
    return {
      configKey: AI_RESOURCE_CONFIG_KEY,
      effective: this.current,
      defaults: AI_RESOURCE_DEFAULTS,
      fields: AI_RESOURCE_FIELDS,
      source: this.source,
      revision: this.revision,
      legacyEnvironmentPresent: this.legacyPresent,
    };
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  apply(settings: AIResourceSettingsDto, revision = String(Date.now())) {
    this.generation++;
    this.current = deepFreeze(structuredClone(settings));
    this.source = "database";
    this.revision = revision;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        logger.warn("AI resource listener failed; configuration remains applied");
      }
    }
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const generation = this.generation;
      const row = await this.repository.findByKey(AI_RESOURCE_CONFIG_KEY);
      if (generation !== this.generation) return;
      if (!row) return;
      const revision = row.updateTime.toISOString();
      if (revision === this.revision) return;
      this.apply(this.parse(row.value), revision);
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  async start() {
    await this.refresh().catch(() =>
      logger.warn("AI resource initial refresh failed; retaining bootstrap configuration"),
    );
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh().catch(() => logger.warn("AI resource refresh failed; retaining last valid configuration"));
    }, AI_RESOURCE_REFRESH_MS);
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
