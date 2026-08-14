export enum i18nEventEnum {
  LOCALE_CHANGED, // 语言已切换
}

export enum WindowEventEnum {
  RESIZE, // 窗口大小改变
}

export enum AprilFoolsEventEnum {
  TRIGGER_EGG, // 触发指定彩蛋
  TRIGGER_RANDOM_EGG, // 触发随机彩蛋
  RUN_AUTO_SEQUENCE, // 运行一键演示序列
  OPEN_PANEL, // 打开彩蛋面板
  SYNC_LOCAL_STATE, // 同步本地开关状态
}

export type I18N_EVENTS = keyof typeof i18nEventEnum
export type WINDOW_EVENTS = keyof typeof WindowEventEnum
export type APRIL_FOOLS_EVENTS = keyof typeof AprilFoolsEventEnum
