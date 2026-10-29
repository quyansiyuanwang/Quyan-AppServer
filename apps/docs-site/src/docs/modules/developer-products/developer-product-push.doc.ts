import contentEn from '@/content/en/developer-product-push.md?raw'
import contentZh from '@/content/zh-CN/developer-product-push.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({
  slug: 'developer-product-push',
  category: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  title: { en: 'Push API', 'zh-CN': '推送聚合 API' },
  summary: {
    en: 'Configure channels, send messages, and check delivery, retry, and usage results.',
    'zh-CN': '配置渠道、发送消息，并核对投递、重试和用量结果。',
  },
  tags: ['push', 'webhook', 'retry', 'idempotency', 'iam', 'secret'],
  updatedAt: '2026-10-30',
  content: { en: contentEn, 'zh-CN': contentZh },
})
