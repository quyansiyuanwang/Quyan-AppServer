import contentEn from '@/content/en/developer-product-ip-geolocation.md?raw'
import contentZh from '@/content/zh-CN/developer-product-ip-geolocation.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({ slug: 'developer-product-ip-geolocation', category: { en: 'Developer Products', 'zh-CN': '开发者产品' }, title: { en: 'IP Geolocation API', 'zh-CN': 'IP 定位 API' }, summary: { en: 'Look up public IP location and ASN details.', 'zh-CN': '查询公网 IP 的定位和 ASN 信息。' }, tags: ['ip-geolocation'], content: { en: contentEn, 'zh-CN': contentZh } })
