import contentEn from "@/content/en/oj-api-key-management.md?raw";
import contentZh from "@/content/zh-CN/oj-api-key-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "oj-api-key-management",
  category: {
    en: "OJ",
    "zh-CN": "OJ",
  },
  title: {
    en: "OJ API key management",
    "zh-CN": "OJ API Key 管理",
  },
  summary: {
    en: "Maintain OJ submitter keys, bindings, and usage metadata.",
    "zh-CN": "说明 OJ 提交器密钥、绑定信息和用量元数据。",
  },
  tags: ["oj", "api-key", "submitter"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
