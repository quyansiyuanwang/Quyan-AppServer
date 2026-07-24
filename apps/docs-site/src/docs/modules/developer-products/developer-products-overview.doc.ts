import contentEn from '@/content/en/developer-products-overview.md?raw'
import contentZh from '@/content/zh-CN/developer-products-overview.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({ slug: 'developer-products-overview', category: { en: 'Developer Products', 'zh-CN': '开发者产品' }, title: { en: 'Developer Products', 'zh-CN': '开发者产品' }, summary: { en: 'Authenticate product requests with an instance API key.', 'zh-CN': '使用实例 API Key 调用开发者产品。' }, tags: ['developer-products', 'api-key'], content: { en: contentEn, 'zh-CN': contentZh } })
