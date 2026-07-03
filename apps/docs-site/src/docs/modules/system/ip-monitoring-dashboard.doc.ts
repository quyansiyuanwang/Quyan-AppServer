import contentEn from "@/content/en/ip-monitoring-dashboard.md?raw";
import contentZh from "@/content/zh-CN/ip-monitoring-dashboard.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "ip-monitoring-dashboard",
  category: {
    en: "System",
    "zh-CN": "系统",
  },
  title: {
    en: "IP monitoring dashboard",
    "zh-CN": "IP 监控面板",
  },
  summary: {
    en: "Query IP risk state and maintain blacklist or whitelist records.",
    "zh-CN": "说明 IP 风险查询与黑白名单维护。",
  },
  tags: ["ip", "monitoring", "blacklist"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
