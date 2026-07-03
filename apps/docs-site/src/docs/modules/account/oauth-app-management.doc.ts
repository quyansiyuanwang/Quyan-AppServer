import contentEn from "@/content/en/oauth-app-management.md?raw";
import contentZh from "@/content/zh-CN/oauth-app-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "oauth-app-management",
  category: {
    en: "Account",
    "zh-CN": "账号",
  },
  title: {
    en: "OAuth app management",
    "zh-CN": "OAuth 应用管理",
  },
  summary: {
    en: "Register applications, manage redirect URIs, and rotate client secrets safely.",
    "zh-CN": "说明应用注册、回调地址管理，以及如何安全轮换客户端密钥。",
  },
  tags: ["oauth", "application", "client"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
