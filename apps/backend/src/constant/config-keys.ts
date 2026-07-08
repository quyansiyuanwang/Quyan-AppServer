/**
 * 服务器配置项的 key 常量
 */

export const CONFIG_KEYS = {
  HEARTBEAT: {
    INTERVAL_SECONDS: "heartbeat.intervalSeconds",
    TIMEOUT_SECONDS: "heartbeat.timeoutSeconds",
  },
  REMOTE_TERMINAL: {
    UNBIND_MAX_COUNT: "remoteTerminal.unbind.maxCount",
    UNBIND_WINDOW_HOURS: "remoteTerminal.unbind.windowHours",
    REBIND_COOLDOWN_MINUTES: "remoteTerminal.unbind.rebindCooldownMinutes",
  },
  BILLING: {
    RECHARGE_RATIO: "billing.rechargeRatio",
  },
  CAPTCHA: {
    PROVIDER: "captcha.provider",
    FALLBACK_PROVIDER: "captcha.fallbackProvider",
    MIN_SCORE: "captcha.minScore",
    TRUST_WINDOW_MINUTES: "captcha.trustWindowMinutes",
  },
  REGISTRATION: {
    ENABLED: "registration.enabled",
    MAX_ACCOUNTS_PER_EMAIL: "registration.maxAccountsPerEmail",
    DEFAULT_GROUP_USERNAME: "registration.defaultGroupUsername",
    VERIFICATION_CODE_EXPIRY: "registration.verificationCodeExpiry",
  },
  SMTP: {
    HOST: "smtp.host",
    PORT: "smtp.port",
    SECURE: "smtp.secure",
    USER: "smtp.user",
    PASSWORD: "smtp.password",
    SENDER_NAME: "smtp.senderName",
    SENDER_EMAIL: "smtp.senderEmail",
  },
  NOTIFICATION: {
    DEFAULT_SUBSCRIBED_EVENTS: "notification.defaultSubscribedEvents",
    DEFAULT_THRESHOLDS: "notification.defaultThresholds",
    TICKET_ASSIGNMENT_RULES: "notification.ticketAssignmentRules",
  },
  IP_BAN: {
    ENABLED: "ipBan.enabled",
    ERROR_WEIGHTS: "ipBan.errorWeights",
    LEVEL_1_THRESHOLD: "ipBan.level1Threshold",
    LEVEL_1_DURATION: "ipBan.level1Duration",
    LEVEL_2_THRESHOLD: "ipBan.level2Threshold",
    LEVEL_2_DURATION: "ipBan.level2Duration",
    LEVEL_3_THRESHOLD: "ipBan.level3Threshold",
    LEVEL_3_DURATION: "ipBan.level3Duration",
    ERROR_DECAY_ENABLED: "ipBan.errorDecayEnabled",
    ERROR_DECAY_RATE: "ipBan.errorDecayRate",
    ERROR_DECAY_MIN_THRESHOLD: "ipBan.errorDecayMinThreshold",
    ERROR_DECAY_INTERVAL: "ipBan.errorDecayInterval",
  },
  SITE: {
    BACKEND_PUBLIC_URL: "site.backendPublicUrl",
  },
  RELAY: {
    UPSTREAM_URL: "relay.upstreamUrl",
    UPSTREAM_API_KEY: "relay.upstreamApiKey",
    OPENAI_UPSTREAM_URL: "relay.openaiUpstreamUrl",
    OPENAI_UPSTREAM_API_KEY: "relay.openaiUpstreamApiKey",
    ANTHROPIC_UPSTREAM_URL: "relay.anthropicUpstreamUrl",
    ANTHROPIC_UPSTREAM_API_KEY: "relay.anthropicUpstreamApiKey",
    ALLOWED_MODELS: "relay.allowedModels",
    MODEL_RATES: "relay.modelRates",
    GLOBAL_MULTIPLIER: "relay.globalMultiplier",
    CUSTOM_KEY_ENABLED: "relay.customKey.enabled",
    CUSTOM_KEY_MAX_TOKENS_PER_USER: "relay.customKey.maxTokensPerUser",
    CUSTOM_KEY_CREATE_LIMIT_WINDOW_MINUTES: "relay.customKey.createLimitWindowMinutes",
    CUSTOM_KEY_CREATE_LIMIT_MAX_COUNT: "relay.customKey.createLimitMaxCount",
  },
} as const;
