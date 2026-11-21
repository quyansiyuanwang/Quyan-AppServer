import contentEn from '@/content/en/balance-management.md?raw'
import contentZh from '@/content/zh-CN/balance-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'balance-management',
  updatedAt: '2026-11-21',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'Balance management',
    'zh-CN': '余额管理',
  },
  summary: {
    en: 'Manage overdraft defaults and user policies, correct account statistics, and verify balance transactions.',
    'zh-CN': '管理默认与用户超额规则，独立修正账户余额和统计，核对近期交易。',
  },
  tags: ['balance', 'finance', 'admin'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
