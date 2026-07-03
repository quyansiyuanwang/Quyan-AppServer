import contentEn from "@/content/en/node-sdk.md?raw";
import contentZh from "@/content/zh-CN/node-sdk.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "node-sdk",
  category: {
    en: "Reference",
    "zh-CN": "参考",
  },
  title: {
    en: "Node SDK",
    "zh-CN": "Node SDK",
  },
  summary: {
    en: "Minimal Node.js API calling templates for backend integrations.",
    "zh-CN": "用于后端集成的最小 Node.js API 调用模板。",
  },
  tags: ["sdk", "node", "api", "backend"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
