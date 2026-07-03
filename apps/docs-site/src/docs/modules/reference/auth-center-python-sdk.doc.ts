import contentEn from "@/content/en/auth-center-python-sdk.md?raw";
import contentZh from "@/content/zh-CN/auth-center-python-sdk.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "auth-center-python-sdk",
  category: {
    en: "Reference",
    "zh-CN": "参考",
  },
  title: {
    en: "Auth Center Python SDK",
    "zh-CN": "认证中心 Python SDK",
  },
  summary: {
    en: "Python examples for token exchange, refresh, and JWT verification against JWKS.",
    "zh-CN": "使用 Python 完成令牌交换、刷新以及基于 JWKS 的 JWT 校验示例。",
  },
  tags: ["auth-center", "sdk", "python", "jwks", "jwt"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
