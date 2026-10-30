import contentEn from '@/content/en/error-center.md?raw'
import contentZh from '@/content/zh-CN/error-center.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'error-center',
  category: { en: 'System', 'zh-CN': '系统' },
  title: { en: 'Error center', 'zh-CN': '错误中心' },
  summary: {
    en: 'Find error groups, inspect recent occurrences, track handling status, and understand collection and retention limits.',
    'zh-CN': '查找错误组、排查最近发生记录、更新处理状态，了解采集和保留范围。',
  },
  tags: ['errors', 'diagnostics', 'retention', 'iam', 'authorization'],
  updatedAt: '2026-10-30',
  content: { en: contentEn, 'zh-CN': contentZh },
})
