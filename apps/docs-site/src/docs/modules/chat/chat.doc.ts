import contentEn from "@/content/en/chat.md?raw";
import contentZh from "@/content/zh-CN/chat.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "chat",
  category: {
    en: "Chat",
    "zh-CN": "对话",
  },
  title: {
    en: "Chat",
    "zh-CN": "聊天",
  },
  summary: {
    en: "Conversation list, message actions, and mobile usage guidance.",
    "zh-CN": "说明会话列表、消息操作与移动端使用方式。",
  },
  tags: ["chat", "conversation", "message"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
