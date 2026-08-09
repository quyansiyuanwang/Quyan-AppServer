import contentEn from '@/content/en/error-center.md?raw'
import contentZh from '@/content/zh-CN/error-center.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'error-center',
  category: { en: 'System', 'zh-CN': '系统' },
  title: { en: 'Error center', 'zh-CN': '错误中心' },
  summary: {
    en: 'Investigate aggregated frontend and backend errors.',
    'zh-CN': '查看和处置聚合后的前后端错误。',
  },
  tags: ['errors', 'diagnostics', 'retention'],
  updatedAt: '2026-08-08',
  content: { en: contentEn, 'zh-CN': contentZh },
})
