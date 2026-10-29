import contentEn from '@/content/en/monthly-pass-purchase.md?raw'
import contentZh from '@/content/zh-CN/monthly-pass-purchase.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({
  slug: 'monthly-pass-purchase',
  category: { en: 'Account', 'zh-CN': '账号' },
  title: { en: 'Purchase a monthly pass', 'zh-CN': '月卡购买' },
  summary: {
    en: 'Redeem published monthly pass plans with balance and understand resource permissions and purchase limits.',
    'zh-CN': '使用余额购买已发布月卡方案，了解资源权限和购买次数限制。',
  },
  tags: ['monthly-pass', 'purchase', 'balance', 'iam'],
  updatedAt: '2026-10-30',
  content: { en: contentEn, 'zh-CN': contentZh },
})
