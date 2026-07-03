import contentEn from "@/content/en/relay-token-management.md?raw";
import contentZh from "@/content/zh-CN/relay-token-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "relay-token-management",
  category: {
    en: "Relay",
    "zh-CN": "转发",
  },
  title: {
    en: "Relay token management",
    "zh-CN": "转发 Token 管理",
  },
  summary: {
    en: "Manage relay tokens, quotas, channels, and failover behavior.",
    "zh-CN": "说明转发 Token、额度、渠道和故障转移行为。",
  },
  tags: ["relay", "token", "failover"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
