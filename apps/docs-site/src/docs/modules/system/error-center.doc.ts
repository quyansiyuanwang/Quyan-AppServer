import contentEn from '@/content/en/error-center.md?raw'
import contentZh from '@/content/zh-CN/error-center.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'error-center',
  category: { en: 'System', 'zh-CN': '系统' },
  title: { en: 'Error center', 'zh-CN': '错误中心' },
  summary: {
    en: 'Investigate aggregated errors and control error group lists, details, and occurrences with IAM.',
    'zh-CN': '查看聚合错误，并通过 IAM 控制错误组列表、详情与发生记录访问。',
  },
  tags: ['errors', 'diagnostics', 'retention', 'iam', 'authorization'],
  updatedAt: '2026-10-14',
  content: { en: contentEn, 'zh-CN': contentZh },
})
