import contentEn from '@/content/en/developer-product-kv.md?raw'
import contentZh from '@/content/zh-CN/developer-product-kv.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({ slug: 'developer-product-kv', category: { en: 'Developer Products', 'zh-CN': '开发者产品' }, title: { en: 'KV Storage API', 'zh-CN': 'KV 存储 API' }, summary: { en: 'Store JSON values with optional TTL.', 'zh-CN': '保存带可选 TTL 的 JSON 值。' }, tags: ['kv'], content: { en: contentEn, 'zh-CN': contentZh } })
