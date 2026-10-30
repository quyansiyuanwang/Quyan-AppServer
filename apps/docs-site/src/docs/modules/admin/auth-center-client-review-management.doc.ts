import contentEn from '@/content/en/auth-center-client-review-management.md?raw'
import contentZh from '@/content/zh-CN/auth-center-client-review-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  updatedAt: '2026-10-30',
  slug: 'auth-center-client-review-management',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'Auth Center app review',
    'zh-CN': '认证中心应用审核',
  },
  summary: {
    en: 'Find submissions, check review eligibility and integration details, and handle decisions and deletion.',
    'zh-CN': '查找申请，核对审核资格和接入资料，完成审核决策与删除处理。',
  },
  tags: ['auth-center', 'review', 'grant-type', 'approval'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
