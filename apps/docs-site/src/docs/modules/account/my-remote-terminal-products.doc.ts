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
    en: 'View purchased remote terminal product plans, entitlements, and bound devices.',
    'zh-CN': '查看已购买的远程终端产品方案、权益与绑定设备。',
  },
  tags: ['remote', 'terminal', 'device', 'entitlement', 'plan'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
