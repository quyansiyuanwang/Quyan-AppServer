import contentEn from '@/content/en/oj-usage-statistics.md?raw'
import contentZh from '@/content/zh-CN/oj-usage-statistics.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'oj-usage-statistics',
  updatedAt: '2026-10-30',
  category: {
    en: 'OJ',
    'zh-CN': 'OJ',
  },
  title: {
    en: 'OJ usage statistics',
    'zh-CN': 'OJ 用量统计',
  },
  summary: {
    en: 'Query your OJ usage, verify settled charges, and understand date and pagination limits.',
    'zh-CN': '查询个人 OJ 用量，核对已结算费用，了解日期范围和分页限制。',
  },
  tags: ['oj', 'usage', 'cost', '用量', '费用', 'Token', '分页'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
