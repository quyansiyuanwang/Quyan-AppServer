import contentEn from '@/content/en/consumption-statistics.md?raw'
import contentZh from '@/content/zh-CN/consumption-statistics.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'consumption-statistics',
  updatedAt: '2026-10-30',
  category: {
    en: 'System',
    'zh-CN': '系统',
  },
  title: {
    en: 'Consumption statistics',
    'zh-CN': '消耗统计',
  },
  summary: {
    en: 'Filter deployment spending reports and distinguish balance charges, pass coverage, and reporting limits.',
    'zh-CN': '筛选部署范围消费报告，区分余额扣费、月卡覆盖及统计口径限制。',
  },
  tags: ['consumption', 'analytics', 'usage', '消费', '扣费', '统计', '月卡'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
