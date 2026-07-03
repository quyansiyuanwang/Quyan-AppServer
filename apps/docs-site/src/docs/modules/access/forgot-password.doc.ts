import contentEn from "@/content/en/forgot-password.md?raw";
import contentZh from "@/content/zh-CN/forgot-password.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "forgot-password",
  category: {
    en: "Access",
    "zh-CN": "访问",
  },
  title: {
    en: "Forgot password",
    "zh-CN": "找回密码",
  },
  summary: {
    en: "Recover account access through email verification and password reset.",
    "zh-CN": "说明通过邮箱验证码重置密码并恢复账号访问。",
  },
  tags: ["password", "recovery", "email"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
