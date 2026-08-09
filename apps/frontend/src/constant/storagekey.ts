const StorageKey = {
  // Theme
  Theme: {
    THEME_TOGGLE_IS_DARK: 'ThemeToggle-isDark',
  },
  // Auth
  Auth: {
    ACCESS_TOKEN: 'Authentication-AccessToken',
    REFRESH_TOKEN: 'Authentication-RefreshToken',
    ACCESS_TOKEN_EXPIRATION: 'Authentication-AccessTokenExpiration',
    REFRESH_TOKEN_EXPIRATION: 'Authentication-RefreshTokenExpiration',
    FORCE_LOGOUT_AT: 'Authentication-ForceLogoutAt',
    PENDING_TWO_FACTOR_CHALLENGE: 'Authentication-PendingTwoFactorChallenge',
    PENDING_POLICY_CONSENT_CHALLENGE: 'Authentication-PendingPolicyConsentChallenge',
    LEGAL_POLICY_CONSENT: 'Authentication-LegalPolicyConsent',
    REPLAY_SIGNING_SESSION: 'Authentication-ReplaySigningSession',
    ONE_TIME_TOKEN: 'oneTimeToken',
  },
  // Util
  Util: {
    LOCALE: 'Util-Locale',
    CLIENT_FINGERPRINT: 'Util-ClientFingerprint',
    HEARTBEAT_LEADER_ID: 'Util-HeartbeatLeaderId',
    HEARTBEAT_LEADER_EXPIRES_AT: 'Util-HeartbeatLeaderExpiresAt',
    ERROR_REPORT_QUEUE: 'Util-ErrorReportQueue',
  },
  // Storage Scope
  Scope: {
    CURRENT: 'StorageScope-Current',
  },
  // User
  User: {
    INFO: 'User-Info',
  },
  // Home
  Home: {
    DASHBOARD_DEFAULT_OPEN: 'Home-DashboardDefaultOpen',
  },
  // Overlay
  Overlay: {
    FLOATING_PANEL_POSITION: 'Overlay-FloatingPanelPosition',
    FLOATING_WORKSPACE_STATE: 'Overlay-FloatingWorkspaceState',
  },
  // Chat
  Chat: {
    SELECTED_TOKEN_ID: 'Chat-SelectedTokenId',
    SELECTED_MODEL: 'Chat-SelectedModel',
  },
  // Relay
  Relay: {
    BALANCE_SCRIPT_SETTINGS: 'Relay-BalanceScriptSettings',
    CHANNEL_PROBE_APPLY_SETTINGS: 'relay-channel-probe:apply-multiplier-settings:v1',
  },
  Tracking: {
    SESSION_ID: 'track_session_id',
  },
  Navigation: {
    PINNED_ROUTES: 'appserver.sidebar.pinnedRoutes',
  },
  Easter: {
    FEATURE_SWITCH: 'AprilFools-feature-switch',
    PREVIEW_MODE: 'AprilFools-preview-mode',
    MASTER_DISABLED: 'AprilFools-master-disabled-2026',
    USER_DISMISS_BY_DAY: 'AprilFools-user-dismiss-day',
    TRIGGERED_BY_DAY: 'AprilFools-triggered-by-day',
    RUN_MODE: 'AprilFools-run-mode',
    PASSIVE_CONFIG_PREFIX: 'AprilFools-passive-config',
  },
  // Impersonation
  Impersonation: {
    ORIGINAL_ACCESS_TOKEN: 'Impersonation-OriginalAccessToken',
    ORIGINAL_REFRESH_TOKEN: 'Impersonation-OriginalRefreshToken',
    ORIGINAL_ACCESS_EXPIRY: 'Impersonation-OriginalAccessExpiry',
    ORIGINAL_REFRESH_EXPIRY: 'Impersonation-OriginalRefreshExpiry',
    ORIGINAL_STORAGE_SCOPE: 'Impersonation-OriginalStorageScope',
    SESSION_INFO: 'Impersonation-SessionInfo',
  },
} as const

export const getAprilFoolsPassiveConfigStorageKey = (mode: string): string =>
  `${StorageKey.Easter.PASSIVE_CONFIG_PREFIX}-${mode}`

export default StorageKey
