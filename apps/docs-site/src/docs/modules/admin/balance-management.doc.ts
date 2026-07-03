import contentEn from "@/content/en/balance-management.md?raw";
import contentZh from "@/content/zh-CN/balance-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "balance-management",
  category: {
    en: "Admin",
    "zh-CN": "管理",
  },
  title: {
    en: "Balance management",
    "zh-CN": "余额管理",
  },
  summary: {
    en: "Search user balances, adjust values, and inspect transaction history.",
    "zh-CN": "说明用户余额查询、调整和交易历史检查。",
  },
  tags: ["balance", "finance", "admin"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
