import contentEn from "@/content/en/sdk-examples.md?raw";
import contentZh from "@/content/zh-CN/sdk-examples.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "sdk-examples",
  category: {
    en: "Reference",
    "zh-CN": "参考",
  },
  title: {
    en: "SDK & Examples",
    "zh-CN": "SDK 与示例",
  },
  summary: {
    en: "Copy-ready Node and Python templates, plus OAuth flow diagrams for fast integration.",
    "zh-CN":
      "提供可直接复制的 Node / Python 模板与 OAuth 流程图，便于快速接入。",
  },
  tags: ["sdk", "example", "oauth", "node", "python"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
