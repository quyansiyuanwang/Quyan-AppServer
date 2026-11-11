import contentEn from '@/content/en/relay-settings.md?raw'
import contentZh from '@/content/zh-CN/relay-settings.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'relay-settings',
  updatedAt: '2026-11-11',
  category: {
    en: 'Relay',
    'zh-CN': '转发',
  },
  title: {
    en: 'Relay settings',
    'zh-CN': '转发设置',
  },
  summary: {
    en: 'Save relay settings and prices, maintain channels and pools, and configure system header allowlists/blocklists with channel inheritance.',
    'zh-CN': '说明全局配置与定价保存、渠道和混池维护、系统请求头黑白名单与渠道继承配置。',
  },
  tags: [
    'relay',
    'settings',
    'pricing',
    'headers',
    'allowlist',
    'blocklist',
    '请求头',
    '白名单',
    '黑名单',
  ],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
