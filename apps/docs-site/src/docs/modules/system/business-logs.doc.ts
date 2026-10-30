import contentEn from '@/content/en/business-logs.md?raw'
import contentZh from '@/content/zh-CN/business-logs.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'business-logs',
  updatedAt: '2026-10-30',
  category: {
    en: 'System',
    'zh-CN': '系统',
  },
  title: {
    en: 'Business logs',
    'zh-CN': '业务日志',
  },
  summary: {
    en: 'Find business operations, interpret audit details, and compare authorized statistics.',
    'zh-CN': '查找业务操作、阅读审计详情，并核对筛选范围和获准统计。',
  },
  tags: ['logs', 'audit', 'business'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
