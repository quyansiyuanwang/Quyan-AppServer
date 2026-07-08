import BusinessLogService from "./businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { ALL_NOTIFICATION_EVENTS, NotificationEvent, THRESHOLD_EVENTS } from "@/constant/notification-event";
import { EnvSpace } from "@/config/env";
import { ServerConfigRepository } from "@/store/system/server-config.repository";
import type { ServerConfigStore } from "@/store/system/server-config.store";
import type { Request } from "express";

const DEFAULT_RECHARGE_RATIO = 100;
const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;
const DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 90;
const DEFAULT_REMOTE_TERMINAL_UNBIND_MAX_COUNT = 3;
const DEFAULT_REMOTE_TERMINAL_UNBIND_WINDOW_HOURS = 24;
const DEFAULT_REMOTE_TERMINAL_REBIND_COOLDOWN_MINUTES = 60;
const DEFAULT_NOTIFICATION_THRESHOLDS: Record<string, number> = {
  [NotificationEvent.BALANCE_LOW]: 10,
  [NotificationEvent.MONTHLY_PASS_QUOTA_LOW]: 20,
  [NotificationEvent.MONTHLY_PASS_DAILY_LIMIT]: 80,
  [NotificationEvent.RELAY_TOKEN_QUOTA_LOW]: 80,
};
const DEFAULT_SUBSCRIBED_NOTIFICATION_EVENTS = [...ALL_NOTIFICATION_EVENTS];
const DEFAULT_RELAY_CUSTOM_KEY_ENABLED = true;
const DEFAULT_RELAY_CUSTOM_KEY_MAX_TOKENS_PER_USER = 3;
const DEFAULT_RELAY_CUSTOM_KEY_CREATE_LIMIT_WINDOW_MINUTES = 10;
const DEFAULT_RELAY_CUSTOM_KEY_CREATE_LIMIT_MAX_COUNT = 5;

export interface RegistrationConfig {
  enabled: boolean;
  maxAccountsPerEmail: number;
  defaultGroupUsername: string;
  verificationCodeExpiry: number;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  senderName: string;
  senderEmail: string;
}

export interface IpBanConfig {
  enabled: boolean;
  level1Threshold: number;
  level1Duration: number;
  level2Threshold: number;
  level2Duration: number;
  level3Threshold: number;
  level3Duration: number;
}

export interface ErrorDecayConfig {
  enabled: boolean;
  decayRate: number;
  minThreshold: number;
  interval: number;
}

export interface ErrorWeights {
  statusCodeWeights: Record<string, number>;
  customCodeWeights: Record<string, number>;
}

export interface ModelConfig {
  allowedModels: string;
}

export interface RelayCustomKeyConfig {
  enabled: boolean;
  maxTokensPerUser: number;
  createLimitWindowMinutes: number;
  createLimitMaxCount: number;
}

export interface RelayConfig {
  upstreamUrl: string;
  upstreamApiKey: string;
  allowedModels: string;
  customKeyEnabled: boolean;
  customKeyMaxTokensPerUser: number;
  customKeyCreateLimitWindowMinutes: number;
  customKeyCreateLimitMaxCount: number;
}

export interface BillingConfig {
  rechargeRatio: number;
}

export interface SiteConfig {
  backendPublicUrl: string;
}

export interface HeartbeatConfig {
  intervalSeconds: number;
  timeoutSeconds: number;
}

export interface RemoteTerminalUnbindConfig {
  maxCount: number;
  windowHours: number;
  rebindCooldownMinutes: number;
}

export type CaptchaProvider = "none" | "recaptcha" | "turnstile";

export interface CaptchaConfig {
  enabled: boolean;
  provider: CaptchaProvider;
  fallbackProvider: CaptchaProvider;
  minScore: number;
  trustWindowMinutes: number;
}

export interface NotificationConfig {
  defaultSubscribedEvents: string[];
  defaultThresholds: Record<string, number>;
  ticketAssignmentRules: TicketAssignmentRule[];
}

export interface TicketAssignmentRule {
  type?: string;
  priority?: string;
  assigneeUserIds: string[];
}

export interface TicketAssignmentConfig {
  rules: TicketAssignmentRule[];
}

function sanitizeInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export class ConfigService {
  private static instance: ConfigService;
  private errorWeightsCache: ErrorWeights | null = null;
  private errorWeightsCacheTime: number = 0;
  private readonly CACHE_TTL = 60000; // 1 minute

  private constructor(
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly serverConfigRepository: ServerConfigStore = ServerConfigRepository.getInstance(),
  ) {}

  static getInstance(): ConfigService {
    if (!ConfigService.instance) ConfigService.instance = new ConfigService();

    return ConfigService.instance;
  }

  private getClientIP(req?: Request): string {
    if (!req) return "unknown";
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return typeof forwarded === "string" ? forwarded.split(",")[0].trim() : forwarded[0];
    return req.ip || req.socket.remoteAddress || "unknown";
  }

  async get(key: string): Promise<string | null> {
    const config = await this.serverConfigRepository.findByKey(key);
    return config?.value ?? null;
  }

  async set(key: string, value: string, actorUserId?: string, request?: Request): Promise<void> {
    await this.serverConfigRepository.upsert(key, value);

    if (actorUserId)
      await this.businessLogService.logOperation({
        operationType: OperationType.SYSTEM_CONFIG_UPDATE,
        operationCategory: OperationCategory.SYSTEM,
        actorUserId,
        targetResourceType: "SERVER_CONFIG",
        description: `配置项 '${key}' 已更新`,
        changes: { key, value: key.includes("password") ? "***" : value },
        success: true,
        ipAddress: this.getClientIP(request),
        userAgent: request?.headers["user-agent"],
        requestId: request?.headers["x-request-id"] as string | undefined,
      });
  }

  async getMultiple(keys: string[]): Promise<Record<string, string>> {
    const configs = await this.serverConfigRepository.findByKeys(keys);
    const result: Record<string, string> = {};
    for (const config of configs) result[config.key] = config.value;

    return result;
  }

  async setMultiple(configs: Record<string, string>, actorUserId?: string, request?: Request): Promise<void> {
    for (const [key, value] of Object.entries(configs)) await this.set(key, value, actorUserId, request);
  }

  async getAllConfigs(): Promise<Record<string, string>> {
    const configs = await this.serverConfigRepository.findAll();
    const result: Record<string, string> = {};
    for (const config of configs) result[config.key] = config.value;

    return result;
  }

  async getRegistrationConfig(): Promise<RegistrationConfig> {
    const keys = Object.values(CONFIG_KEYS.REGISTRATION);
    const configs = await this.getMultiple(keys);
    return {
      enabled: configs[CONFIG_KEYS.REGISTRATION.ENABLED] === "true",
      maxAccountsPerEmail: parseInt(configs[CONFIG_KEYS.REGISTRATION.MAX_ACCOUNTS_PER_EMAIL] || "3", 10),
      defaultGroupUsername: configs[CONFIG_KEYS.REGISTRATION.DEFAULT_GROUP_USERNAME] || "user",
      verificationCodeExpiry: parseInt(configs[CONFIG_KEYS.REGISTRATION.VERIFICATION_CODE_EXPIRY] || "300", 10),
    };
  }

  async getBillingConfig(): Promise<BillingConfig> {
    const rechargeRatio = await this.get(CONFIG_KEYS.BILLING.RECHARGE_RATIO);
    const parsed = rechargeRatio ? parseFloat(rechargeRatio) : DEFAULT_RECHARGE_RATIO;

    return {
      rechargeRatio: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RECHARGE_RATIO,
    };
  }

  async getHeartbeatConfig(): Promise<HeartbeatConfig> {
    const keys = [CONFIG_KEYS.HEARTBEAT.INTERVAL_SECONDS, CONFIG_KEYS.HEARTBEAT.TIMEOUT_SECONDS];
    const configs = await this.getMultiple(keys);
    const intervalSeconds = sanitizeInt(
      configs[CONFIG_KEYS.HEARTBEAT.INTERVAL_SECONDS],
      DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
      5,
      3600,
    );
    const timeoutSeconds = sanitizeInt(
      configs[CONFIG_KEYS.HEARTBEAT.TIMEOUT_SECONDS],
      DEFAULT_HEARTBEAT_TIMEOUT_SECONDS,
      10,
      86400,
    );

    return {
      intervalSeconds,
      timeoutSeconds: Math.max(timeoutSeconds, intervalSeconds + 5),
    };
  }

  async getRemoteTerminalUnbindConfig(): Promise<RemoteTerminalUnbindConfig> {
    const keys = Object.values(CONFIG_KEYS.REMOTE_TERMINAL);
    const configs = await this.getMultiple(keys);

    return {
      maxCount: sanitizeInt(
        configs[CONFIG_KEYS.REMOTE_TERMINAL.UNBIND_MAX_COUNT],
        DEFAULT_REMOTE_TERMINAL_UNBIND_MAX_COUNT,
        0,
        1000,
      ),
      windowHours: sanitizeInt(
        configs[CONFIG_KEYS.REMOTE_TERMINAL.UNBIND_WINDOW_HOURS],
        DEFAULT_REMOTE_TERMINAL_UNBIND_WINDOW_HOURS,
        1,
        24 * 365,
      ),
      rebindCooldownMinutes: sanitizeInt(
        configs[CONFIG_KEYS.REMOTE_TERMINAL.REBIND_COOLDOWN_MINUTES],
        DEFAULT_REMOTE_TERMINAL_REBIND_COOLDOWN_MINUTES,
        0,
        60 * 24 * 365,
      ),
    };
  }

  async getCaptchaConfig(): Promise<CaptchaConfig> {
    const keys = [
      CONFIG_KEYS.CAPTCHA.PROVIDER,
      CONFIG_KEYS.CAPTCHA.FALLBACK_PROVIDER,
      CONFIG_KEYS.CAPTCHA.MIN_SCORE,
      CONFIG_KEYS.CAPTCHA.TRUST_WINDOW_MINUTES,
    ];
    const configs = await this.getMultiple(keys);
    const envEnabled = EnvSpace.recaptchaConfig.enabled;
    const provider = this.parseCaptchaProvider(
      configs[CONFIG_KEYS.CAPTCHA.PROVIDER] || (envEnabled ? "recaptcha" : "none"),
    );
    const fallbackProvider = this.parseCaptchaProvider(configs[CONFIG_KEYS.CAPTCHA.FALLBACK_PROVIDER] || "none");
    const parsedMinScore = parseFloat(
      configs[CONFIG_KEYS.CAPTCHA.MIN_SCORE] || String(EnvSpace.recaptchaConfig.minScore),
    );
    const parsedTrustWindowMinutes = parseInt(
      configs[CONFIG_KEYS.CAPTCHA.TRUST_WINDOW_MINUTES] || String(EnvSpace.captchaTrustConfig.windowMinutes),
      10,
    );

    return {
      enabled: provider !== "none",
      provider,
      fallbackProvider,
      minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : EnvSpace.recaptchaConfig.minScore,
      trustWindowMinutes: Number.isFinite(parsedTrustWindowMinutes)
        ? Math.min(1440, Math.max(0, parsedTrustWindowMinutes))
        : EnvSpace.captchaTrustConfig.windowMinutes,
    };
  }

  async getRechargeRatio(): Promise<number> {
    const config = await this.getBillingConfig();
    return config.rechargeRatio;
  }

  async getSiteConfig(): Promise<SiteConfig> {
    const url = await this.get(CONFIG_KEYS.SITE.BACKEND_PUBLIC_URL);
    return { backendPublicUrl: url || "" };
  }

  async getSmtpConfig(): Promise<SmtpConfig> {
    const keys = Object.values(CONFIG_KEYS.SMTP);
    const configs = await this.getMultiple(keys);
    return {
      host: configs[CONFIG_KEYS.SMTP.HOST] || "",
      port: parseInt(configs[CONFIG_KEYS.SMTP.PORT] || "465", 10),
      secure: configs[CONFIG_KEYS.SMTP.SECURE] !== "false",
      user: configs[CONFIG_KEYS.SMTP.USER] || "",
      password: configs[CONFIG_KEYS.SMTP.PASSWORD] || "",
      senderName: configs[CONFIG_KEYS.SMTP.SENDER_NAME] || "AppSystem",
      senderEmail: configs[CONFIG_KEYS.SMTP.SENDER_EMAIL] || "",
    };
  }

  async getNotificationConfig(): Promise<NotificationConfig> {
    const configs = await this.getMultiple(Object.values(CONFIG_KEYS.NOTIFICATION));

    try {
      const rawEvents = configs[CONFIG_KEYS.NOTIFICATION.DEFAULT_SUBSCRIBED_EVENTS];
      const parsedEvents = rawEvents ? JSON.parse(rawEvents) : [];
      const rawThresholds = configs[CONFIG_KEYS.NOTIFICATION.DEFAULT_THRESHOLDS];
      const parsedThresholds = rawThresholds ? JSON.parse(rawThresholds) : {};
      const normalizedThresholds =
        parsedThresholds && typeof parsedThresholds === "object"
          ? Object.fromEntries(
              THRESHOLD_EVENTS.map((key) => {
                const value = (parsedThresholds as Record<string, unknown>)[key];
                const normalizedValue =
                  typeof value === "number" && Number.isFinite(value) && value >= 0
                    ? value
                    : DEFAULT_NOTIFICATION_THRESHOLDS[key];
                return [key, normalizedValue];
              }),
            )
          : DEFAULT_NOTIFICATION_THRESHOLDS;

      return {
        defaultSubscribedEvents: Array.isArray(parsedEvents)
          ? parsedEvents.filter((item): item is string => typeof item === "string")
          : DEFAULT_SUBSCRIBED_NOTIFICATION_EVENTS,
        defaultThresholds: normalizedThresholds,
        ticketAssignmentRules: (await this.getTicketAssignmentConfig()).rules,
      };
    } catch {
      return {
        defaultSubscribedEvents: DEFAULT_SUBSCRIBED_NOTIFICATION_EVENTS,
        defaultThresholds: DEFAULT_NOTIFICATION_THRESHOLDS,
        ticketAssignmentRules: (await this.getTicketAssignmentConfig()).rules,
      };
    }
  }

  async getTicketAssignmentConfig(): Promise<TicketAssignmentConfig> {
    const raw = await this.get(CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES);
    if (!raw) return { rules: [] };

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return { rules: [] };

      const rules = parsed
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          type: typeof item.type === "string" && item.type.trim() ? item.type.trim() : undefined,
          priority: typeof item.priority === "string" && item.priority.trim() ? item.priority.trim() : undefined,
          assigneeUserIds: Array.isArray(item.assigneeUserIds)
            ? item.assigneeUserIds.filter(
                (value): value is string => typeof value === "string" && value.trim().length > 0,
              )
            : [],
        }))
        .filter((item) => item.assigneeUserIds.length > 0);

      return { rules };
    } catch {
      return { rules: [] };
    }
  }

  async setTicketAssignmentConfig(
    config: TicketAssignmentConfig,
    actorUserId?: string,
    request?: Request,
  ): Promise<void> {
    await this.set(
      CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES,
      JSON.stringify(config.rules),
      actorUserId,
      request,
    );
  }

  async getIpBanConfig(): Promise<IpBanConfig> {
    const keys = Object.values(CONFIG_KEYS.IP_BAN);
    const configs = await this.getMultiple(keys);
    return {
      enabled: configs[CONFIG_KEYS.IP_BAN.ENABLED] === "true",
      level1Threshold: parseInt(configs[CONFIG_KEYS.IP_BAN.LEVEL_1_THRESHOLD] || "10", 10),
      level1Duration: parseInt(configs[CONFIG_KEYS.IP_BAN.LEVEL_1_DURATION] || "3600", 10),
      level2Threshold: parseInt(configs[CONFIG_KEYS.IP_BAN.LEVEL_2_THRESHOLD] || "20", 10),
      level2Duration: parseInt(configs[CONFIG_KEYS.IP_BAN.LEVEL_2_DURATION] || "86400", 10),
      level3Threshold: parseInt(configs[CONFIG_KEYS.IP_BAN.LEVEL_3_THRESHOLD] || "50", 10),
      level3Duration: parseInt(configs[CONFIG_KEYS.IP_BAN.LEVEL_3_DURATION] || "-1", 10),
    };
  }

  async getModelConfig(): Promise<ModelConfig> {
    const allowedModels = await this.get(CONFIG_KEYS.RELAY.ALLOWED_MODELS);
    return {
      allowedModels: allowedModels || "",
    };
  }

  async getErrorWeights(): Promise<ErrorWeights> {
    const now = Date.now();
    if (this.errorWeightsCache && now - this.errorWeightsCacheTime < this.CACHE_TTL) return this.errorWeightsCache;

    const weightsJson = await this.get(CONFIG_KEYS.IP_BAN.ERROR_WEIGHTS);
    const defaultWeights: ErrorWeights = {
      statusCodeWeights: { "400": 1, "401": 0, "403": 2, "404": 0.3, "422": 1, "429": 0, "500": 3 },
      customCodeWeights: { "1012": 5, "1013": 0, "1014": 2 },
    };

    if (!weightsJson) {
      this.errorWeightsCache = defaultWeights;
      this.errorWeightsCacheTime = now;
      return defaultWeights;
    }

    try {
      const parsed = JSON.parse(weightsJson);
      this.errorWeightsCache = {
        statusCodeWeights: parsed.statusCodeWeights || defaultWeights.statusCodeWeights,
        customCodeWeights: parsed.customCodeWeights || defaultWeights.customCodeWeights,
      };
      this.errorWeightsCacheTime = now;
      return this.errorWeightsCache;
    } catch {
      this.errorWeightsCache = defaultWeights;
      this.errorWeightsCacheTime = now;
      return defaultWeights;
    }
  }

  async getRelayConfig(): Promise<RelayConfig> {
    const configs = await this.getMultiple(Object.values(CONFIG_KEYS.RELAY));
    return {
      upstreamUrl: configs[CONFIG_KEYS.RELAY.UPSTREAM_URL] || "",
      upstreamApiKey: configs[CONFIG_KEYS.RELAY.UPSTREAM_API_KEY] || "",
      allowedModels: configs[CONFIG_KEYS.RELAY.ALLOWED_MODELS] || "",
      customKeyEnabled:
        (configs[CONFIG_KEYS.RELAY.CUSTOM_KEY_ENABLED] || String(DEFAULT_RELAY_CUSTOM_KEY_ENABLED)) === "true",
      customKeyMaxTokensPerUser: sanitizeInt(
        configs[CONFIG_KEYS.RELAY.CUSTOM_KEY_MAX_TOKENS_PER_USER],
        DEFAULT_RELAY_CUSTOM_KEY_MAX_TOKENS_PER_USER,
        0,
        1000,
      ),
      customKeyCreateLimitWindowMinutes: sanitizeInt(
        configs[CONFIG_KEYS.RELAY.CUSTOM_KEY_CREATE_LIMIT_WINDOW_MINUTES],
        DEFAULT_RELAY_CUSTOM_KEY_CREATE_LIMIT_WINDOW_MINUTES,
        1,
        525600,
      ),
      customKeyCreateLimitMaxCount: sanitizeInt(
        configs[CONFIG_KEYS.RELAY.CUSTOM_KEY_CREATE_LIMIT_MAX_COUNT],
        DEFAULT_RELAY_CUSTOM_KEY_CREATE_LIMIT_MAX_COUNT,
        0,
        100000,
      ),
    };
  }

  async getRelayCustomKeyConfig(): Promise<RelayCustomKeyConfig> {
    const relayConfig = await this.getRelayConfig();
    return {
      enabled: relayConfig.customKeyEnabled,
      maxTokensPerUser: relayConfig.customKeyMaxTokensPerUser,
      createLimitWindowMinutes: relayConfig.customKeyCreateLimitWindowMinutes,
      createLimitMaxCount: relayConfig.customKeyCreateLimitMaxCount,
    };
  }

  async getOpenAIConfig(): Promise<{ upstreamUrl: string; upstreamApiKey: string } | null> {
    const url = await this.get(CONFIG_KEYS.RELAY.OPENAI_UPSTREAM_URL);
    const key = await this.get(CONFIG_KEYS.RELAY.OPENAI_UPSTREAM_API_KEY);
    if (!url || !key) return null;
    return { upstreamUrl: url, upstreamApiKey: key };
  }

  async getAnthropicConfig(): Promise<{ upstreamUrl: string; upstreamApiKey: string } | null> {
    const url = await this.get(CONFIG_KEYS.RELAY.ANTHROPIC_UPSTREAM_URL);
    const key = await this.get(CONFIG_KEYS.RELAY.ANTHROPIC_UPSTREAM_API_KEY);
    if (!url || !key) return null;
    return { upstreamUrl: url, upstreamApiKey: key };
  }

  async getErrorDecayConfig(): Promise<ErrorDecayConfig> {
    const keys = [
      CONFIG_KEYS.IP_BAN.ERROR_DECAY_ENABLED,
      CONFIG_KEYS.IP_BAN.ERROR_DECAY_RATE,
      CONFIG_KEYS.IP_BAN.ERROR_DECAY_MIN_THRESHOLD,
      CONFIG_KEYS.IP_BAN.ERROR_DECAY_INTERVAL,
    ];
    const configs = await this.getMultiple(keys);
    return {
      enabled: configs[CONFIG_KEYS.IP_BAN.ERROR_DECAY_ENABLED] === "true",
      decayRate: parseFloat(configs[CONFIG_KEYS.IP_BAN.ERROR_DECAY_RATE] || "5"),
      minThreshold: parseFloat(configs[CONFIG_KEYS.IP_BAN.ERROR_DECAY_MIN_THRESHOLD] || "0.1"),
      interval: parseInt(configs[CONFIG_KEYS.IP_BAN.ERROR_DECAY_INTERVAL] || "1", 10),
    };
  }

  async getModelRates(): Promise<Record<string, any> | null> {
    const ratesJson = await this.get(CONFIG_KEYS.RELAY.MODEL_RATES);
    if (!ratesJson) return null;
    return JSON.parse(ratesJson);
  }

  async getGlobalMultiplier(): Promise<number> {
    const multiplier = await this.get(CONFIG_KEYS.RELAY.GLOBAL_MULTIPLIER);
    return multiplier ? parseFloat(multiplier) : 1;
  }

  private parseCaptchaProvider(value: string): CaptchaProvider {
    if (value === "none" || value === "recaptcha" || value === "turnstile") return value;
    return "none";
  }
}
