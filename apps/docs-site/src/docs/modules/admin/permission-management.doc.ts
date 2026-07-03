import contentEn from "@/content/en/permission-management.md?raw";
import contentZh from "@/content/zh-CN/permission-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "permission-management",
  category: {
    en: "Admin",
    "zh-CN": "管理",
  },
  title: {
    en: "Permission management",
    "zh-CN": "权限管理",
  },
  summary: {
    en: "Inspect effective permissions and adjust user-level overrides.",
    "zh-CN": "说明生效权限查看与用户级覆盖调整。",
  },
  tags: ["permission", "rbac", "override"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
