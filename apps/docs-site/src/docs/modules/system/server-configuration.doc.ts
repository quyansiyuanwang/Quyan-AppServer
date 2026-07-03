import contentEn from "@/content/en/server-configuration.md?raw";
import contentZh from "@/content/zh-CN/server-configuration.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "server-configuration",
  category: {
    en: "System",
    "zh-CN": "系统",
  },
  title: {
    en: "Server configuration",
    "zh-CN": "服务端配置",
  },
  summary: {
    en: "Maintain registration, billing, SMTP, and IP-ban related settings.",
    "zh-CN": "说明注册、计费、SMTP 与 IP 封禁相关设置。",
  },
  tags: ["server", "config", "smtp"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
