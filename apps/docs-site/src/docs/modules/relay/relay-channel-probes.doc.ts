import contentEn from '@/content/en/relay-channel-probes.md?raw'
import contentZh from '@/content/zh-CN/relay-channel-probes.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'relay-channel-probes',
  updatedAt: '2026-10-30',
  category: { en: 'Relay', 'zh-CN': '转发' },
  title: { en: 'Channel balance probes', 'zh-CN': '渠道余额探针' },
  summary: {
    en: 'Configure balance measurement, inspect calibration and upstream costs, and apply channel or pool multipliers.',
    'zh-CN': '配置余额测量、核对校准与上游费用，确认后应用独立渠道或混池倍率。',
  },
  tags: ['relay', 'channel', 'balance', 'probe'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
