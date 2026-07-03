import contentEn from "@/content/en/getting-started.md?raw";
import contentZh from "@/content/zh-CN/getting-started.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "getting-started",
  category: {
    en: "Intro",
    "zh-CN": "入门",
  },
  title: {
    en: "User manual",
    "zh-CN": "用户手册",
  },
  summary: {
    en: "How to use the page-by-page manual and find the right screen guide.",
    "zh-CN": "说明如何使用按页面拆分的用户手册并找到对应界面说明。",
  },
  tags: ["manual", "search", "index"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
