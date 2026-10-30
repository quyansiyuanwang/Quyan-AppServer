import contentEn from '@/content/en/channel-provider-revenue.md?raw'
import contentZh from '@/content/zh-CN/channel-provider-revenue.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'channel-provider-revenue',
  category: { en: 'Relay', 'zh-CN': '转发' },
  title: { en: 'Channel supply and earnings', 'zh-CN': '渠道供应与收益' },
  summary: {
    en: 'Submit and revise supplied channels, follow reviews, and understand earnings and manual settlement limits.',
    'zh-CN': '提交与修改供应渠道、跟踪审核，并了解收益计算及手动结算范围。',
  },
  tags: ['relay', 'channel', 'provider', 'earnings', 'review', 'settlement'],
  updatedAt: '2026-10-30',
  content: { en: contentEn, 'zh-CN': contentZh },
})
