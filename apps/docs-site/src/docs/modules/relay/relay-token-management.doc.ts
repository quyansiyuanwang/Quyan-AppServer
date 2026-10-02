import contentEn from '@/content/en/relay-token-management.md?raw'
import contentZh from '@/content/zh-CN/relay-token-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'relay-token-management',
  updatedAt: '2026-10-02',
  category: {
    en: 'Relay',
    'zh-CN': '转发',
  },
  title: {
    en: 'Relay token management',
    'zh-CN': '转发 Token 管理',
  },
  summary: {
    en: 'Manage relay tokens, nested compositions, quotas, model routes, and failover.',
    'zh-CN': '说明转发 Token、嵌套组合、额度、模型路由和故障转移行为。',
  },
  tags: ['relay', 'token', 'composite', 'routing', 'failover'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
