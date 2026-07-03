import contentEn from "@/content/en/consumption-statistics.md?raw";
import contentZh from "@/content/zh-CN/consumption-statistics.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "consumption-statistics",
  category: {
    en: "System",
    "zh-CN": "系统",
  },
  title: {
    en: "Consumption statistics",
    "zh-CN": "消耗统计",
  },
  summary: {
    en: "Analyze usage by user, model, channel, and relay token.",
    "zh-CN": "说明按用户、模型、渠道和转发 Token 分析使用量。",
  },
  tags: ["consumption", "analytics", "usage"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
