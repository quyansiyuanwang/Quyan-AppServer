import contentEn from '@/content/en/relay-settings.md?raw'
import contentZh from '@/content/zh-CN/relay-settings.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'relay-settings',
  updatedAt: '2026-11-24',
  category: {
    en: 'Relay',
    'zh-CN': '转发',
  },
  title: {
    en: 'Relay settings',
    'zh-CN': '转发设置',
  },
  summary: {
    en: 'Save relay settings and prices, maintain channels and pools, configure header policies, and distinguish channel billing mappings from token model rules.',
    'zh-CN':
      '说明全局配置与定价、渠道和混池维护、请求头策略，并区分渠道计费映射与 Token 模型规则。',
  },
  tags: [
    'relay',
    'settings',
    'pricing',
    'headers',
    'allowlist',
    'blocklist',
    'model mapping',
    '模型映射',
    '计费模型',
    '请求头',
    '白名单',
    '黑名单',
  ],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
