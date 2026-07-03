import contentEn from "@/content/en/login-register.md?raw";
import contentZh from "@/content/zh-CN/login-register.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "login-register",
  category: {
    en: "Access",
    "zh-CN": "访问",
  },
  title: {
    en: "Login / Register",
    "zh-CN": "登录 / 注册",
  },
  summary: {
    en: "Sign in, register, consent to policies, and enter with passkey when available.",
    "zh-CN": "说明登录、注册、政策同意，以及可用时的 passkey 登录。",
  },
  tags: ["login", "register", "passkey"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
