import contentEn from '@/content/en/developer-product-kv.md?raw'
import contentZh from '@/content/zh-CN/developer-product-kv.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({
  slug: 'developer-product-kv',
  category: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  title: { en: 'KV Storage API', 'zh-CN': 'KV 存储 API' },
  summary: {
    en: 'Manage JSON entries, expiry and capacity, integrate the API, and understand billing and permissions.',
    'zh-CN': '管理 JSON 条目、到期时间和容量，接入 API 并了解计量与授权范围。',
  },
  tags: ['kv', 'json', 'ttl', 'quota'],
  updatedAt: '2026-10-30',
  content: { en: contentEn, 'zh-CN': contentZh },
})
