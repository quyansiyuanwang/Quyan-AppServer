import contentEn from "@/content/en/oauth-app-review-management.md?raw";
import contentZh from "@/content/zh-CN/oauth-app-review-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "oauth-app-review-management",
  category: {
    en: "Admin",
    "zh-CN": "管理",
  },
  title: {
    en: "OAuth app review management",
    "zh-CN": "OAuth 应用审核",
  },
  summary: {
    en: "Review submitted OAuth apps, approve or reject them, and remove invalid records when needed.",
    "zh-CN": "说明 OAuth 应用的审核、通过 / 拒绝处理，以及必要时的删除动作。",
  },
  tags: ["oauth", "review", "approval", "redirect-uri"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
