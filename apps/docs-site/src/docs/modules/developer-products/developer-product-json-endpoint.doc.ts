import contentEn from '@/content/en/developer-product-json-endpoint.md?raw'
import contentZh from '@/content/zh-CN/developer-product-json-endpoint.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'developer-product-json-endpoint',
  updatedAt: '2026-10-30',
  category: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  title: { en: 'JSON Endpoints', 'zh-CN': 'JSON 端点' },
  summary: {
    en: 'Edit JSON, choose shared or product-key access, and handle signing, usage and withdrawal.',
    'zh-CN': '编辑 JSON，选择分享或产品 Key 访问，并了解签名、用量与撤回方式。',
  },
  tags: ['json', 'endpoint', 'api-key'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
