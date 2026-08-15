import contentEn from '@/content/en/support-assistant.md?raw'
import contentZh from '@/content/zh-CN/support-assistant.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
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
    en: 'Use the documentation-aware support agent, human handoff, and optional user-funded Relay mode.',
    'zh-CN': '说明文档 Agent、转人工以及可选的用户自费中转模式。',
  },
  tags: ['support', 'agent', 'relay', 'ticket'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
