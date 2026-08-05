import contentEn from '@/content/en/balance-history.md?raw'
import contentZh from '@/content/zh-CN/balance-history.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'balance-history',
  category: {
    en: 'Account',
    'zh-CN': '账号',
  },
  title: {
    en: 'Account balance & transfers',
    'zh-CN': '账户余额与转出',
  },
  summary: {
    en: 'Check your balance, redeem codes, create gift codes, transfer balance, and review account transactions.',
    'zh-CN': '说明余额查看、兑换充值、生成兑换码、直接转账和账户资金流水。',
  },
  tags: ['balance', 'redemption', 'gift-code', 'transfer', 'transaction'],
  updatedAt: '2026-08-05',
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
