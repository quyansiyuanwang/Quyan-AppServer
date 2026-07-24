import contentEn from '@/content/en/developer-product-short-link.md?raw'
import contentZh from '@/content/zh-CN/developer-product-short-link.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({ slug: 'developer-product-short-link', category: { en: 'Developer Products', 'zh-CN': '开发者产品' }, title: { en: 'Short Link API', 'zh-CN': '短链接 API' }, summary: { en: 'Create and manage redirect links.', 'zh-CN': '创建和管理跳转短链接。' }, tags: ['short-link'], content: { en: contentEn, 'zh-CN': contentZh } })
