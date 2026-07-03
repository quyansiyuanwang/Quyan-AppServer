import contentEn from "@/content/en/upstream-status.md?raw";
import contentZh from "@/content/zh-CN/upstream-status.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "upstream-status",
  category: {
    en: "Relay",
    "zh-CN": "转发",
  },
  title: {
    en: "Upstream status",
    "zh-CN": "上游状态",
  },
  summary: {
    en: "Monitor upstream health, heartbeat history, and latency indicators.",
    "zh-CN": "说明上游健康度、心跳历史和延迟指标。",
  },
  tags: ["upstream", "status", "monitoring"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
