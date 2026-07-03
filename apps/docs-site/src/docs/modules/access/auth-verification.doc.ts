import contentEn from "@/content/en/auth-verification.md?raw";
import contentZh from "@/content/zh-CN/auth-verification.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "auth-verification",
  category: {
    en: "Access",
    "zh-CN": "访问",
  },
  title: {
    en: "Verification",
    "zh-CN": "验证页面",
  },
  summary: {
    en: "Handle login verification, step-up checks, and recovery-code flows.",
    "zh-CN": "说明登录验证、二次校验与恢复码流程。",
  },
  tags: ["verification", "2fa", "recovery-code"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
