import contentEn from "@/content/en/not-found-404.md?raw";
import contentZh from "@/content/zh-CN/not-found-404.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "not-found-404",
  category: {
    en: "Other",
    "zh-CN": "其他",
  },
  title: {
    en: "404 not found",
    "zh-CN": "404 未找到",
  },
  summary: {
    en: "Fallback guidance when a requested page no longer exists.",
    "zh-CN": "说明访问页面不存在时的返回与恢复方式。",
  },
  tags: ["404", "fallback", "routing"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
