import contentEn from '@/content/en/developer-product-verification.md?raw'
import contentZh from '@/content/zh-CN/developer-product-verification.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({
  slug: 'developer-product-verification',
  updatedAt: '2026-10-30',
  category: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  title: { en: 'Verification API', 'zh-CN': '验证码 API' },
  summary: {
    en: 'Send and verify email or SMS codes, handle expiry and resending, and check usage.',
    'zh-CN': '发送和校验邮件或短信验证码，了解有效期、重发限制与用量统计。',
  },
  tags: ['verification', 'email', 'sms', 'quota'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
