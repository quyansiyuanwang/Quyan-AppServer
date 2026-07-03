import contentEn from "@/content/en/oauth-demo.md?raw";
import contentZh from "@/content/zh-CN/oauth-demo.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "oauth-demo",
  category: {
    en: "Reference",
    "zh-CN": "参考",
  },
  title: {
    en: "OAuth Demo",
    "zh-CN": "OAuth Demo",
  },
  summary: {
    en: "Authorization-code flow diagrams and copy-ready Node/Python OAuth demos.",
    "zh-CN": "提供授权码流程图与可直接复制的 Node/Python OAuth Demo。",
  },
  tags: ["oauth", "demo", "sequence", "node", "python"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
