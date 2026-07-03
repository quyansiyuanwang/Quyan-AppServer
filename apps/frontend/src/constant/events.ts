export enum AuthEventEnum {
  ACCESS_TOKEN_REFRESHED, // Access token 已刷新
  ACCESS_TOKEN_REFRESH_FAILED, // Access token 刷新失败
  REQUEST_REFRESH_TOKEN, // 请求刷新 token
  TOKEN_EXPIRED_DUE_TO_UPDATE, // Token因用户信息变更而过期
  FORCE_LOGOUT_DETECTED, // 检测到本地强制下线标记
  USER_LOGGED_OUT, // 用户已登出
  USER_INFO_UPDATED, // 用户信息已更新
  USER_LOGGED_IN, // 用户已登录
}

export enum i18nEventEnum {
  LOCALE_CHANGED, // 语言已切换
}

export enum WindowEventEnum {
  RESIZE, // 窗口大小改变
}

export enum GlobalEventEnum {
  FORBIDDEN, // 权限不足
  UNAUTHORIZED, // 认证失败
}

export enum AprilFoolsEventEnum {
  TRIGGER_EGG, // 触发指定彩蛋
  TRIGGER_RANDOM_EGG, // 触发随机彩蛋
  RUN_AUTO_SEQUENCE, // 运行一键演示序列
  OPEN_PANEL, // 打开彩蛋面板
  SYNC_LOCAL_STATE, // 同步本地开关状态
}

export type AUTH_EVENTS = keyof typeof AuthEventEnum
export type I18N_EVENTS = keyof typeof i18nEventEnum
export type WINDOW_EVENTS = keyof typeof WindowEventEnum
export type GLOBAL_EVENTS = keyof typeof GlobalEventEnum
export type APRIL_FOOLS_EVENTS = keyof typeof AprilFoolsEventEnum
