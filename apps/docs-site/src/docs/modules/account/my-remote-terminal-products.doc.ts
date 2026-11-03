import contentEn from '@/content/en/my-remote-terminal-products.md?raw'
import contentZh from '@/content/zh-CN/my-remote-terminal-products.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'my-remote-terminal-products',
  category: {
    en: 'Account',
    'zh-CN': '账号',
  },
  title: {
    en: 'My remote terminal products',
    'zh-CN': '我的远程终端产品',
  },
  summary: {
    en: 'Purchase or renew remote terminal entitlements, check charges, install agents, and unbind devices.',
    'zh-CN': '购买或续期远程终端权益，核对费用、安装 Agent 并解绑设备。',
  },
  tags: [
    'remote',
    'terminal',
    'device',
    'entitlement',
    'plan',
    '续期',
    '安装令牌',
    '解绑',
    'billing',
  ],
  updatedAt: '2026-10-30',
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
