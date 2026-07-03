import contentEn from "@/content/en/account-settings.md?raw";
import contentZh from "@/content/zh-CN/account-settings.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "account-settings",
  category: {
    en: "Account",
    "zh-CN": "账号",
  },
  title: {
    en: "Settings",
    "zh-CN": "设置",
  },
  summary: {
    en: "Profile, password, email, theme, language, and security controls.",
    "zh-CN": "说明资料、密码、邮箱、主题、语言与安全控制。",
  },
  tags: ["settings", "profile", "security"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
