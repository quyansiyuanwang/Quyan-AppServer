import contentEn from '@/content/en/system-statistics.md?raw'
import contentZh from '@/content/zh-CN/system-statistics.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'system-statistics',
  updatedAt: '2026-10-30',
  category: {
    en: 'System',
    'zh-CN': '系统',
  },
  title: {
    en: 'System statistics',
    'zh-CN': '系统统计',
  },
  summary: {
    en: 'Refresh instance statistics and interpret memory, CPU, Redis, application counts, and build information.',
    'zh-CN': '刷新实例统计，了解内存、CPU、Redis、应用计数和构建信息的指标口径。',
  },
  tags: ['system', 'stats', 'runtime'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
