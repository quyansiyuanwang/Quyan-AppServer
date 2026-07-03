import contentEn from "@/content/en/article-management.md?raw";
import contentZh from "@/content/zh-CN/article-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "article-management",
  category: {
    en: "Admin",
    "zh-CN": "管理",
  },
  title: {
    en: "Article management",
    "zh-CN": "文章管理",
  },
  summary: {
    en: "Create, edit, publish, and sort articles and knowledge pages.",
    "zh-CN": "说明文章与知识内容的创建、编辑、发布和排序。",
  },
  tags: ["article", "editor", "publish"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
