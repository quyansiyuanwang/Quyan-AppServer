import contentEn from "@/content/en/redemption-code-management.md?raw";
import contentZh from "@/content/zh-CN/redemption-code-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "redemption-code-management",
  category: {
    en: "Admin",
    "zh-CN": "管理",
  },
  title: {
    en: "Redemption code management",
    "zh-CN": "兑换码管理",
  },
  summary: {
    en: "Create, distribute, and track redemption codes.",
    "zh-CN": "说明兑换码的创建、发放和状态追踪。",
  },
  tags: ["redemption", "code", "balance"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
