import contentEn from "@/content/en/business-logs.md?raw";
import contentZh from "@/content/zh-CN/business-logs.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "business-logs",
  category: {
    en: "System",
    "zh-CN": "系统",
  },
  title: {
    en: "Business logs",
    "zh-CN": "业务日志",
  },
  summary: {
    en: "Review audit-style business activity, changes, and error details.",
    "zh-CN": "说明审计型业务活动、变更记录和错误详情。",
  },
  tags: ["logs", "audit", "business"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
