import contentEn from "@/content/en/relay-settings.md?raw";
import contentZh from "@/content/zh-CN/relay-settings.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "relay-settings",
  category: {
    en: "Relay",
    "zh-CN": "转发",
  },
  title: {
    en: "Relay settings",
    "zh-CN": "转发设置",
  },
  summary: {
    en: "Configure relay-wide behavior, monitoring rules, and pricing settings.",
    "zh-CN": "说明全局转发行为、监控规则和价格配置。",
  },
  tags: ["relay", "settings", "pricing"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
