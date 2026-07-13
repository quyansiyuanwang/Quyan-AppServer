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
  },
  // Util
  Util: {
    LOCALE: 'Util-Locale',
    CLIENT_FINGERPRINT: 'Util-ClientFingerprint',
    HEARTBEAT_LEADER_ID: 'Util-HeartbeatLeaderId',
    HEARTBEAT_LEADER_EXPIRES_AT: 'Util-HeartbeatLeaderExpiresAt',
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

export default StorageKey
