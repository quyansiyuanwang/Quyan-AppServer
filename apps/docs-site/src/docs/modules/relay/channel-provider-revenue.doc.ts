import contentEn from '@/content/en/channel-provider-revenue.md?raw'
import contentZh from '@/content/zh-CN/channel-provider-revenue.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'channel-provider-revenue',
  category: { en: 'Relay', 'zh-CN': '转发' },
  title: { en: 'Channel supply and earnings', 'zh-CN': '渠道供应与收益' },
  summary: {
    en: 'Submit standalone relay channels and understand provider earnings.',
    'zh-CN': '提交独立中转渠道并了解提供者收益。',
  },
  tags: ['relay', 'channel', 'provider', 'earnings'],
  updatedAt: '2026-08-08',
  content: { en: contentEn, 'zh-CN': contentZh },
})
