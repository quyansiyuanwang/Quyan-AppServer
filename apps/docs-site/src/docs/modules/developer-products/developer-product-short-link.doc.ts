import contentEn from '@/content/en/developer-product-short-link.md?raw'
import contentZh from '@/content/zh-CN/developer-product-short-link.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({
  slug: 'developer-product-short-link',
  category: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  title: { en: 'Short Link API', 'zh-CN': '短链接 API' },
  summary: {
    en: 'Create, pause and share redirect links, interpret visitor statistics, and check usage.',
    'zh-CN': '创建、暂停和分享跳转链接，了解访客统计、有效期与用量规则。',
  },
  tags: ['short-link', 'redirect', 'analytics', 'quota'],
  updatedAt: '2026-10-30',
  content: { en: contentEn, 'zh-CN': contentZh },
})
