import contentEn from '@/content/en/balance-management.md?raw'
import contentZh from '@/content/zh-CN/balance-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'balance-management',
  updatedAt: '2026-10-30',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'Balance management',
    'zh-CN': '余额管理',
  },
  summary: {
    en: 'Find users, apply balance adjustments, and verify recent transactions and access scope.',
    'zh-CN': '查询用户余额、提交增减调整，核对近期交易及权限范围。',
  },
  tags: ['balance', 'finance', 'admin'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
