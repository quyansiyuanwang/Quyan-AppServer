import contentEn from "@/content/en/balance-history.md?raw";
import contentZh from "@/content/zh-CN/balance-history.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "balance-history",
  category: {
    en: "Account",
    "zh-CN": "账号",
  },
  title: {
    en: "Balance & usage history",
    "zh-CN": "余额与用量记录",
  },
  summary: {
    en: "Check balance, redeem codes, and review usage trends and transactions.",
    "zh-CN": "说明余额查看、兑换码使用、趋势图和交易记录。",
  },
  tags: ["balance", "usage", "transaction"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
