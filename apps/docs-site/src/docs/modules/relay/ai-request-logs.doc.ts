import contentEn from '@/content/en/ai-request-logs.md?raw'
import contentZh from '@/content/zh-CN/ai-request-logs.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'ai-request-logs',
  category: { en: 'Relay', 'zh-CN': '转发' },
  title: { en: 'AI request logs', 'zh-CN': 'AI 请求日志' },
  summary: {
    en: 'Find AI requests, inspect outcomes and saved content, and understand capture limits, archives, and access.',
    'zh-CN': '查找 AI 请求、调查执行结果和已保存正文，了解采集限制、历史归档与访问权限。',
  },
  tags: ['relay', 'logs', 'audit', 'content safety', 'iam', 'authorization'],
  updatedAt: '2026-10-30',
  content: { en: contentEn, 'zh-CN': contentZh },
})
