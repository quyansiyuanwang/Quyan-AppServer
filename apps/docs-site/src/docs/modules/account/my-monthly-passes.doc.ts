import contentEn from "@/content/en/my-monthly-passes.md?raw";
import contentZh from "@/content/zh-CN/my-monthly-passes.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "my-monthly-passes",
  category: {
    en: "Account",
    "zh-CN": "账号",
  },
  title: {
    en: "My monthly passes",
    "zh-CN": "我的月卡",
  },
  summary: {
    en: "Review your assigned monthly passes, quotas, and validity windows.",
    "zh-CN": "说明个人月卡、额度和有效期窗口。",
  },
  tags: ["monthly-pass", "quota", "benefit"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
