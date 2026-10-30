import contentEn from '@/content/en/developer-products-overview.md?raw'
import contentZh from '@/content/zh-CN/developer-products-overview.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({
  slug: 'developer-products-overview',
  updatedAt: '2026-10-30',
  category: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  title: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  summary: {
    en: 'Create instances and API keys, understand usage, and manage account quota and pricing.',
    'zh-CN': '创建实例和 API Key，了解用量，并管理账号额度与产品价格。',
  },
  tags: ['developer-products', 'api-key', 'quota', 'billing', 'iam'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
