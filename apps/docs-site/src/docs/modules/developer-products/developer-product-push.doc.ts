import contentEn from '@/content/en/developer-product-push.md?raw'
import contentZh from '@/content/zh-CN/developer-product-push.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({
  slug: 'developer-product-push',
  category: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  title: { en: 'Push API', 'zh-CN': '推送聚合 API' },
  summary: {
    en: 'Deliver messages through configured channels.',
    'zh-CN': '通过配置好的渠道投递消息。',
  },
  tags: ['push'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
