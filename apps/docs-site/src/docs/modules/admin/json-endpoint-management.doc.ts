import contentEn from "@/content/en/json-endpoint-management.md?raw";
import contentZh from "@/content/zh-CN/json-endpoint-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "json-endpoint-management",
  category: {
    en: "Admin",
    "zh-CN": "管理",
  },
  title: {
    en: "JSON endpoint management",
    "zh-CN": "JSON 端点管理",
  },
  summary: {
    en: "Publish JSON endpoints with public or protected access.",
    "zh-CN": "说明 JSON 端点的发布、公开访问和保护访问。",
  },
  tags: ["json", "endpoint", "publish"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
