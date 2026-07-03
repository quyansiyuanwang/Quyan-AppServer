import contentEn from "@/content/en/script-manager.md?raw";
import contentZh from "@/content/zh-CN/script-manager.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "script-manager",
  category: {
    en: "Tools",
    "zh-CN": "工具",
  },
  title: {
    en: "Script manager",
    "zh-CN": "脚本管理",
  },
  summary: {
    en: "Run approved scripts, inspect output, and review script history.",
    "zh-CN": "说明脚本执行、输出查看和历史记录。",
  },
  tags: ["script", "automation", "execution"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
