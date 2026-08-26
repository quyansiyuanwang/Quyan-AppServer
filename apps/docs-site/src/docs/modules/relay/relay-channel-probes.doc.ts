import contentEn from '@/content/en/relay-channel-probes.md?raw'
import contentZh from '@/content/zh-CN/relay-channel-probes.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'relay-channel-probes',
  category: { en: 'Relay', 'zh-CN': '转发' },
  title: { en: 'Channel balance probes', 'zh-CN': '渠道余额探针' },
  summary: {
    en: 'Run and review balance probes for standalone channels and pooled members.',
    'zh-CN': '运行并查看独立渠道和混池成员的余额探针。',
  },
  tags: ['relay', 'channel', 'balance', 'probe'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
