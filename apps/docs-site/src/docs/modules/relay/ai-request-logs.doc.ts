import contentEn from '@/content/en/ai-request-logs.md?raw'
import contentZh from '@/content/zh-CN/ai-request-logs.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'ai-request-logs',
  category: { en: 'Relay', 'zh-CN': '转发' },
  title: { en: 'AI request logs', 'zh-CN': 'AI 请求日志' },
  summary: {
    en: 'Investigate saved AI requests and control log collection, detail, and diagnostic access with IAM.',
    'zh-CN': '调查已保存的 AI 请求，并通过 IAM 控制日志列表、详情与诊断访问。',
  },
  tags: ['relay', 'logs', 'audit', 'content safety', 'iam', 'authorization'],
  updatedAt: '2026-10-14',
  content: { en: contentEn, 'zh-CN': contentZh },
})
