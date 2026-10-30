import contentEn from '@/content/en/remote-terminal-management.md?raw'
import contentZh from '@/content/zh-CN/remote-terminal-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'remote-terminal-management',
  category: {
    en: 'Relay',
    'zh-CN': '转发',
  },
  title: {
    en: 'Remote terminal management',
    'zh-CN': '远程终端管理',
  },
  summary: {
    en: 'Publish terminal plans, assign and adjust entitlements, rotate credentials, and revoke device bindings.',
    'zh-CN': '发布终端套餐，分配和调整权益，轮换凭据并撤销设备绑定。',
  },
  tags: [
    'remote',
    'terminal',
    'management',
    'entitlement',
    'device',
    '权益分配',
    '解绑',
    '令牌轮换',
  ],
  updatedAt: '2026-10-30',
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
