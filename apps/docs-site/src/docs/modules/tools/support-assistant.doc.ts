import contentEn from '@/content/en/support-assistant.md?raw'
import contentZh from '@/content/zh-CN/support-assistant.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  updatedAt: '2026-10-30',
  slug: 'support-assistant',
  category: {
    en: 'Tools',
    'zh-CN': '工具',
  },
  title: {
    en: 'AI Support Agent',
    'zh-CN': 'AI 客服 Agent',
  },
  summary: {
    en: 'Ask for help, manage support history, create a human-support ticket, and configure Relay funding.',
    'zh-CN': '提问与查看回答、管理客服会话、转人工工单及配置自费中转。',
  },
  tags: ['support', 'agent', 'relay', 'ticket'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
