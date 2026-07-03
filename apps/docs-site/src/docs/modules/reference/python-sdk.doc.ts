import contentEn from "@/content/en/python-sdk.md?raw";
import contentZh from "@/content/zh-CN/python-sdk.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "python-sdk",
  category: {
    en: "Reference",
    "zh-CN": "参考",
  },
  title: {
    en: "Python SDK",
    "zh-CN": "Python SDK",
  },
  summary: {
    en: "Minimal Python API calling templates for scripts and backend services.",
    "zh-CN": "用于脚本与后端服务的最小 Python API 调用模板。",
  },
  tags: ["sdk", "python", "api", "backend"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
