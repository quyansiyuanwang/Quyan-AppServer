import contentEn from '@/content/en/analytics.md?raw'
import contentZh from '@/content/zh-CN/analytics.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'analytics',
  updatedAt: '2026-10-30',
  category: {
    en: 'Analytics',
    'zh-CN': '数据分析',
  },
  title: {
    en: 'Analytics',
    'zh-CN': '数据分析',
  },
  summary: {
    en: 'Query event overviews, session funnels, and heatmaps with clear time, count, and permission limits.',
    'zh-CN': '查询事件总览、会话漏斗和热力图，了解时间、统计数量及报表授权范围。',
  },
  tags: ['analytics', 'funnel', 'heatmap', 'tracking', 'events', '漏斗', '热力图', '会话'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
