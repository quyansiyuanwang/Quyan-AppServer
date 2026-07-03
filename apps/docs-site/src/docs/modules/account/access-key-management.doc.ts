import contentEn from "@/content/en/access-key-management.md?raw";
import contentZh from "@/content/zh-CN/access-key-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "access-key-management",
  category: {
    en: "Account",
    "zh-CN": "账号",
  },
  title: {
    en: "Access key management",
    "zh-CN": "访问密钥管理",
  },
  summary: {
    en: "Create, copy, review, and remove account access keys.",
    "zh-CN": "说明账号访问密钥的创建、复制、查看和删除。",
  },
  tags: ["access-key", "security", "key"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
