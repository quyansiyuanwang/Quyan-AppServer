import contentEn from '@/content/en/chat.md?raw'
import contentZh from '@/content/zh-CN/chat.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'chat',
  category: {
    en: 'Chat',
    'zh-CN': '对话',
  },
  title: {
    en: 'Chat',
    'zh-CN': '聊天',
  },
  summary: {
    en: 'Start chats, manage messages, understand retries and charges, and use Agent mode.',
    'zh-CN': '开始聊天、管理消息，了解重试与计费规则及 Agent 模式。',
  },
  tags: ['chat', 'conversation', 'message', 'agent', 'billing'],
  updatedAt: '2026-10-30',
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
