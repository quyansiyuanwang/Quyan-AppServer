import contentEn from '@/content/en/analytics.md?raw'
import contentZh from '@/content/zh-CN/analytics.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'analytics',
  category: {
    en: 'Analytics',
    'zh-CN': '数据分析',
  },
  title: {
    en: 'Analytics',
    'zh-CN': '数据分析',
  },
  summary: {
    en: 'Track user behavior with event overview, conversion funnels, and click heatmaps.',
    'zh-CN': '通过事件概览、转化漏斗和点击热力图追踪用户行为。',
  },
  tags: ['analytics', 'funnel', 'heatmap', 'tracking', 'events'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
