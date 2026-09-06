/**
 * 系统级 OAuth 客户端配置
 * 这些客户端由系统自动创建和管理
 */
export const SYSTEM_OAUTH_CLIENTS = {
  CLI: {
    clientId: "quyan-cli",
    name: "Quyan CLI",
    description: "Official Quyan command-line interface",
  },
  // 未来可扩展
  // DESKTOP: {
  //   clientId: "quyan-desktop",
  //   name: "Quyan Desktop",
  //   description: "Official Quyan desktop application",
  // },
} as const;

export type SystemOAuthClientId = (typeof SYSTEM_OAUTH_CLIENTS)[keyof typeof SYSTEM_OAUTH_CLIENTS]["clientId"];
