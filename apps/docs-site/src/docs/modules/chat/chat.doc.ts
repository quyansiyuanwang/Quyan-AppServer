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
    en: 'Start chats, manage messages, and understand charges and Agent setup limits.',
    'zh-CN': '开始聊天、管理消息，了解计费规则与 Agent 配置的可用范围。',
  },
  tags: ['chat', 'conversation', 'message', 'agent', 'billing'],
  updatedAt: '2026-10-30',
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
