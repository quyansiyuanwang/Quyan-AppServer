import contentEn from "@/content/en/system-logs.md?raw";
import contentZh from "@/content/zh-CN/system-logs.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "system-logs",
  category: {
    en: "System",
    "zh-CN": "系统",
  },
  title: {
    en: "System logs",
    "zh-CN": "系统日志",
  },
  summary: {
    en: "Inspect API logs, request details, and server log files.",
    "zh-CN": "说明 API 日志、请求详情和服务端日志文件查看。",
  },
  tags: ["logs", "request", "server"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
