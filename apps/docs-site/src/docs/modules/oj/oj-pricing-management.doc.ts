import contentEn from "@/content/en/oj-pricing-management.md?raw";
import contentZh from "@/content/zh-CN/oj-pricing-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "oj-pricing-management",
  category: {
    en: "OJ",
    "zh-CN": "OJ",
  },
  title: {
    en: "OJ pricing management",
    "zh-CN": "OJ 价格管理",
  },
  summary: {
    en: "Maintain OJ provider and model pricing rules.",
    "zh-CN": "说明 OJ 供应商与模型价格规则维护。",
  },
  tags: ["oj", "pricing", "model"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
