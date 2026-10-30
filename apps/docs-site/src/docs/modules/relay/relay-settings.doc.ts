import contentEn from '@/content/en/relay-settings.md?raw'
import contentZh from '@/content/zh-CN/relay-settings.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'relay-settings',
  updatedAt: '2026-10-30',
  category: {
    en: 'Relay',
    'zh-CN': '转发',
  },
  title: {
    en: 'Relay settings',
    'zh-CN': '转发设置',
  },
  summary: {
    en: 'Save relay settings and model prices, maintain channels and pools, and check permissions.',
    'zh-CN': '说明全局配置与定价保存、渠道和混池维护流程及权限条件。',
  },
  tags: ['relay', 'settings', 'pricing'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
