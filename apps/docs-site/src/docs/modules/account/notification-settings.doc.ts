import contentEn from "@/content/en/notification-settings.md?raw";
import contentZh from "@/content/zh-CN/notification-settings.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "notification-settings",
  category: {
    en: "Account",
    "zh-CN": "账号",
  },
  title: {
    en: "Notification settings",
    "zh-CN": "通知设置",
  },
  summary: {
    en: "Manage email alerts, webhook targets, thresholds, and delivery history.",
    "zh-CN": "说明通知邮箱、Webhook、告警阈值和投递历史。",
  },
  tags: ["notification", "email", "webhook"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
