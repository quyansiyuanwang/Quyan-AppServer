import contentEn from '@/content/en/monthly-pass-management.md?raw'
import contentZh from '@/content/zh-CN/monthly-pass-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'monthly-pass-management',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'Monthly pass management',
    'zh-CN': '月卡管理',
  },
  summary: {
    en: 'Create plans, assign or extend passes, and verify quotas, coverage, and usage records.',
    'zh-CN': '创建月卡方案、单个或批量发放与续期，核对额度、覆盖范围和使用流水。',
  },
  tags: ['monthly-pass', 'template', 'assignment'],
  updatedAt: '2026-10-30',
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
