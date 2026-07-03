import contentEn from "@/content/en/auth-center-client-management.md?raw";
import contentZh from "@/content/zh-CN/auth-center-client-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "auth-center-client-management",
  category: {
    en: "Admin",
    "zh-CN": "管理",
  },
  title: {
    en: "Auth Center client management",
    "zh-CN": "认证中心应用管理",
  },
  summary: {
    en: "Maintain Auth Center apps in the admin console, including review submission, secret rotation, and deletion.",
    "zh-CN": "说明后台中认证中心应用的创建、编辑、提交审核、轮换密钥和删除。",
  },
  tags: ["auth-center", "application", "review", "pkce", "jwks"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
