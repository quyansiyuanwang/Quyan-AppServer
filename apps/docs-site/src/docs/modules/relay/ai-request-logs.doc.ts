import contentEn from '@/content/en/ai-request-logs.md?raw'
import contentZh from '@/content/zh-CN/ai-request-logs.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'ai-request-logs',
  category: { en: 'Relay', 'zh-CN': '转发' },
  title: { en: 'AI request logs', 'zh-CN': 'AI 请求日志' },
  summary: {
    en: 'Search retained AI request payloads and responses for security investigations.',
    'zh-CN': '检索保留的 AI 请求原文和响应，用于安全事件调查。',
  },
  tags: ['relay', 'logs', 'audit', 'content safety'],
  updatedAt: '2026-09-26',
  content: { en: contentEn, 'zh-CN': contentZh },
})
