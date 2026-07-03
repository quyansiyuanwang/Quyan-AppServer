import contentEn from "@/content/en/user-management.md?raw";
import contentZh from "@/content/zh-CN/user-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "user-management",
  category: {
    en: "Admin",
    "zh-CN": "管理",
  },
  title: {
    en: "User management",
    "zh-CN": "用户管理",
  },
  summary: {
    en: "Create, edit, reset, and maintain user accounts.",
    "zh-CN": "说明用户账号的新建、编辑、重置和维护。",
  },
  tags: ["user", "admin", "account"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
