import contentEn from '@/content/en/developer-product-json-endpoint.md?raw'
import contentZh from '@/content/zh-CN/developer-product-json-endpoint.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'developer-product-json-endpoint',
  category: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  title: { en: 'JSON Endpoints', 'zh-CN': 'JSON 端点' },
  summary: {
    en: 'Publish and access editable JSON documents with product keys.',
    'zh-CN': '通过产品 API Key 发布和访问可编辑的 JSON 文档。',
  },
  tags: ['json', 'endpoint', 'api-key'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
