import contentEn from "@/content/en/remote-terminal-management.md?raw";
import contentZh from "@/content/zh-CN/remote-terminal-management.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "remote-terminal-management",
  category: {
    en: "Relay",
    "zh-CN": "转发",
  },
  title: {
    en: "Remote terminal management",
    "zh-CN": "远程终端管理",
  },
  summary: {
    en: "Manage remote terminal product plans, user entitlements, and device bindings.",
    "zh-CN": "管理远程终端产品套餐、用户权益分配和设备绑定。",
  },
  tags: ["remote", "terminal", "management", "entitlement", "device"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
