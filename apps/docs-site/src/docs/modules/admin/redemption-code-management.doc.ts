import contentEn from '@/content/en/redemption-code-management.md?raw'
import contentZh from '@/content/zh-CN/redemption-code-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'redemption-code-management',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'Redemption code management',
    'zh-CN': '兑换码管理',
  },
  summary: {
    en: 'Generate balance codes, copy complete values, verify redemption, and remove obsolete codes.',
    'zh-CN': '生成余额兑换码、复制完整码、核对领取状态与删除后果。',
  },
  tags: ['redemption', 'code', 'balance', 'iam'],
  updatedAt: '2026-10-30',
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
