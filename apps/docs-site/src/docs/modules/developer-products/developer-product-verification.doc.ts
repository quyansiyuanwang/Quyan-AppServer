import contentEn from '@/content/en/developer-product-verification.md?raw'
import contentZh from '@/content/zh-CN/developer-product-verification.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({
  slug: 'developer-product-verification',
  category: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  title: { en: 'Verification API', 'zh-CN': '验证码 API' },
  summary: { en: 'Send and verify one-time codes.', 'zh-CN': '发送和校验一次性验证码。' },
  tags: ['verification'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
