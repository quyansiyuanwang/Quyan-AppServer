import contentEn from "@/content/en/group-management.md?raw";
import contentZh from "@/content/zh-CN/group-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "group-management",
  category: {
    en: "Admin",
    "zh-CN": "管理",
  },
  title: {
    en: "Group management",
    "zh-CN": "群组管理",
  },
  summary: {
    en: "Maintain groups, descriptions, levels, and group permission sets.",
    "zh-CN": "说明群组、等级、说明和群组权限集合维护。",
  },
  tags: ["group", "permission", "admin"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
