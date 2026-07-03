import contentEn from "@/content/en/oj-usage-statistics.md?raw";
import contentZh from "@/content/zh-CN/oj-usage-statistics.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "oj-usage-statistics",
  category: {
    en: "OJ",
    "zh-CN": "OJ",
  },
  title: {
    en: "OJ usage statistics",
    "zh-CN": "OJ 用量统计",
  },
  summary: {
    en: "Review OJ submitter requests, tokens, cost, and detailed records.",
    "zh-CN": "说明 OJ 提交器请求、Token、费用和明细记录。",
  },
  tags: ["oj", "usage", "cost"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
