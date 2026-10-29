import contentEn from '@/content/en/my-monthly-passes.md?raw'
import contentZh from '@/content/zh-CN/my-monthly-passes.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'my-monthly-passes',
  updatedAt: '2026-10-30',
  category: {
    en: 'Account',
    'zh-CN': '账号',
  },
  title: {
    en: 'My monthly passes',
    'zh-CN': '我的月卡',
  },
  summary: {
    en: 'Check monthly pass validity, quotas, coverage, and remaining balance charges.',
    'zh-CN': '查看月卡有效期、额度、抵扣规则和未覆盖费用的余额扣费。',
  },
  tags: ['monthly-pass', 'quota', 'benefit'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
