import contentEn from "@/content/en/user-online-monitor.md?raw";
import contentZh from "@/content/zh-CN/user-online-monitor.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "user-online-monitor",
  category: {
    en: "System",
    "zh-CN": "系统",
  },
  title: {
    en: "User online monitor",
    "zh-CN": "用户在线监控",
  },
  summary: {
    en: "View online sessions, inspect user detail timelines, force sessions offline, and export history.",
    "zh-CN": "说明在线会话查看、用户详情时间线、强制下线和历史导出。",
  },
  tags: ["session", "online", "monitor", "force-offline", "export"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
