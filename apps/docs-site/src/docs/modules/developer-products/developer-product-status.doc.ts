import contentEn from '@/content/en/developer-product-status.md?raw'
import contentZh from '@/content/zh-CN/developer-product-status.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({ slug: 'developer-product-status', category: { en: 'Developer Products', 'zh-CN': '开发者产品' }, title: { en: 'Status Monitoring API', 'zh-CN': '状态监控 API' }, summary: { en: 'Run monitored HTTP checks and publish status.', 'zh-CN': '执行 HTTP 监控并发布状态。' }, tags: ['status'], content: { en: contentEn, 'zh-CN': contentZh } })
