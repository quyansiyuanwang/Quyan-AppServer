import contentEn from "@/content/en/monthly-pass-management.md?raw";
import contentZh from "@/content/zh-CN/monthly-pass-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "monthly-pass-management",
  category: {
    en: "Admin",
    "zh-CN": "管理",
  },
  title: {
    en: "Monthly pass management",
    "zh-CN": "月卡管理",
  },
  summary: {
    en: "Manage monthly-pass templates, publishing, and user assignments.",
    "zh-CN": "说明月卡模板、发布状态和用户分配管理。",
  },
  tags: ["monthly-pass", "template", "assignment"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
