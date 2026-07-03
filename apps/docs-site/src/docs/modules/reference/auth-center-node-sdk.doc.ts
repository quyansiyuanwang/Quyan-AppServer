import contentEn from "@/content/en/auth-center-node-sdk.md?raw";
import contentZh from "@/content/zh-CN/auth-center-node-sdk.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "auth-center-node-sdk",
  category: {
    en: "Reference",
    "zh-CN": "参考",
  },
  title: {
    en: "Auth Center Node SDK",
    "zh-CN": "认证中心 Node SDK",
  },
  summary: {
    en: "Node.js examples for exchanging codes, refreshing access tokens, and verifying JWTs with JWKS.",
    "zh-CN":
      "使用 Node.js 完成授权码交换、刷新访问令牌，并通过 JWKS 校验 JWT 的示例。",
  },
  tags: ["auth-center", "sdk", "node", "jwks", "jwt"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
