import contentEn from "@/content/en/system-statistics.md?raw";
import contentZh from "@/content/zh-CN/system-statistics.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "system-statistics",
  category: {
    en: "System",
    "zh-CN": "系统",
  },
  title: {
    en: "System statistics",
    "zh-CN": "系统统计",
  },
  summary: {
    en: "Track runtime health, resource usage, and infrastructure summaries.",
    "zh-CN": "说明运行健康度、资源占用和基础设施摘要。",
  },
  tags: ["system", "stats", "runtime"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
