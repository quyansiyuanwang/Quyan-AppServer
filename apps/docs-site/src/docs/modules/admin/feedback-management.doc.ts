import contentEn from "@/content/en/feedback-management.md?raw";
import contentZh from "@/content/zh-CN/feedback-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "feedback-management",
  category: {
    en: "Admin",
    "zh-CN": "管理",
  },
  title: {
    en: "Feedback management",
    "zh-CN": "反馈管理",
  },
  summary: {
    en: "Review, prioritize, and respond to user-submitted feedback and bug reports.",
    "zh-CN": "查看并处理用户提交的反馈和 Bug 报告。",
  },
  tags: ["feedback", "review", "bug", "suggestion"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
