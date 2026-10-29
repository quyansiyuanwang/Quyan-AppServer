import contentEn from '@/content/en/developer-product-ip-geolocation.md?raw'
import contentZh from '@/content/zh-CN/developer-product-ip-geolocation.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({
  slug: 'developer-product-ip-geolocation',
  updatedAt: '2026-10-30',
  category: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  title: { en: 'IP Geolocation API', 'zh-CN': 'IP 定位 API' },
  summary: {
    en: 'Test public IP lookups, integrate the product API, and understand result fields, caching, and usage.',
    'zh-CN': '测试公网 IP 查询、接入产品 API，并了解返回字段、缓存与用量。',
  },
  tags: ['ip-geolocation'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
