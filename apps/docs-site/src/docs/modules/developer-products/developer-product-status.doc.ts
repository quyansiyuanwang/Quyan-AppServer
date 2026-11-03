import contentEn from '@/content/en/developer-product-status.md?raw'
import contentZh from '@/content/zh-CN/developer-product-status.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({
  slug: 'developer-product-status',
  category: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  title: { en: 'Status Monitoring API', 'zh-CN': '状态监控 API' },
  summary: {
    en: 'Configure HTTP checks, manage targets, understand usage and alerts, and publish recent results.',
    'zh-CN': '配置 HTTP 检查、管理目标、了解用量与告警，并发布最近检测结果。',
  },
  tags: ['status', 'iam', 'resource'],
  updatedAt: '2026-10-30',
  content: { en: contentEn, 'zh-CN': contentZh },
})
