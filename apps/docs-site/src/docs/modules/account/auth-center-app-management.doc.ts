import contentEn from "@/content/en/auth-center-app-management.md?raw";
import contentZh from "@/content/zh-CN/auth-center-app-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "auth-center-app-management",
  category: {
    en: "Account",
    "zh-CN": "账号",
  },
  title: {
    en: "Auth Center app management",
    "zh-CN": "认证中心应用管理",
  },
  summary: {
    en: "Register external applications that use this platform as an authentication center with JWT, JWKS, and dual-token refresh behavior.",
    "zh-CN":
      "注册把本平台当作认证中心使用的外部应用，支持 JWT、JWKS 与双令牌刷新机制。",
  },
  tags: ["auth-center", "jwt", "jwks", "refresh-token", "application"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
