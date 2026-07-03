import contentEn from "@/content/en/home-articles.md?raw";
import contentZh from "@/content/zh-CN/home-articles.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "home-articles",
  category: {
    en: "Content",
    "zh-CN": "内容",
  },
  title: {
    en: "Home / Articles",
    "zh-CN": "首页 / 文章",
  },
  summary: {
    en: "Read articles, browse summaries, and navigate long-form content.",
    "zh-CN": "说明文章阅读、摘要浏览和长文导航。",
  },
  tags: ["home", "article", "knowledge"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
