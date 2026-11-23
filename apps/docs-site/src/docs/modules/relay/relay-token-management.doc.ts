import contentEn from '@/content/en/relay-token-management.md?raw'
import contentZh from '@/content/zh-CN/relay-token-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'relay-token-management',
  updatedAt: '2026-11-23',
  category: {
    en: 'Relay',
    'zh-CN': '转发',
  },
  title: {
    en: 'Relay token management',
    'zh-CN': '转发 Token 管理',
  },
  summary: {
    en: 'Manage relay tokens, channel-scoped model mappings and fallback previews, nested compositions, quotas, and failover.',
    'zh-CN': '管理转发 Token、渠道作用域模型映射与回退预览、嵌套组合、额度和故障转移。',
  },
  tags: [
    'relay',
    'token',
    'composite',
    'routing',
    'failover',
    'model mapping',
    'channel scope',
    'mapping-first',
    'original-first',
    'preview',
    '模型映射',
    '渠道作用域',
    '映射优先',
    '原始优先',
    '回退',
    '预览',
  ],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
