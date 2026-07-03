import contentEn from "@/content/en/legal-policy-management.md?raw";
import contentZh from "@/content/zh-CN/legal-policy-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "legal-policy-management",
  category: {
    en: "Admin",
    "zh-CN": "管理",
  },
  title: {
    en: "Legal policy management",
    "zh-CN": "法律政策管理",
  },
  summary: {
    en: "Maintain terms, privacy versions, and publishing status.",
    "zh-CN": "说明条款、隐私版本和发布状态维护。",
  },
  tags: ["legal", "policy", "privacy"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
