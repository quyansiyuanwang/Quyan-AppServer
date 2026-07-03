import contentEn from "@/content/en/auth-center-client-review-management.md?raw";
import contentZh from "@/content/zh-CN/auth-center-client-review-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "auth-center-client-review-management",
  category: {
    en: "Admin",
    "zh-CN": "管理",
  },
  title: {
    en: "Auth Center app review management",
    "zh-CN": "认证中心审核",
  },
  summary: {
    en: "Review submitted Auth Center apps and inspect grant types, redirect URIs, and token settings.",
    "zh-CN": "说明认证中心应用的审核，并核对 grant type、回调地址和令牌设置。",
  },
  tags: ["auth-center", "review", "grant-type", "approval"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
