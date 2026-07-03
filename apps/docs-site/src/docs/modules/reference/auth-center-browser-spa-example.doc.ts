import contentEn from "@/content/en/auth-center-browser-spa-example.md?raw";
import contentZh from "@/content/zh-CN/auth-center-browser-spa-example.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "auth-center-browser-spa-example",
  category: {
    en: "Reference",
    "zh-CN": "参考",
  },
  title: {
    en: "Auth Center Browser / SPA Example",
    "zh-CN": "认证中心 Browser / SPA 示例",
  },
  summary: {
    en: "PKCE and browser-session guidance for public clients using the auth center.",
    "zh-CN": "面向公共客户端的 PKCE 与浏览器会话接入示例。",
  },
  tags: ["auth-center", "spa", "browser", "pkce", "public-client"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
