import contentEn from "@/content/en/debug-tools.md?raw";
import contentZh from "@/content/zh-CN/debug-tools.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "debug-tools",
  category: {
    en: "Tools",
    "zh-CN": "工具",
  },
  title: {
    en: "Debug",
    "zh-CN": "调试页",
  },
  summary: {
    en: "Use support and developer diagnostics, state checks, and quick test tools.",
    "zh-CN": "说明支持与开发排障、状态检查和快速测试工具。",
  },
  tags: ["debug", "tools", "diagnostics"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
