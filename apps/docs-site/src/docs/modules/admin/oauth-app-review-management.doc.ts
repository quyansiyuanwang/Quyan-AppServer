import contentEn from '@/content/en/oauth-app-review-management.md?raw'
import contentZh from '@/content/zh-CN/oauth-app-review-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  updatedAt: '2026-10-30',
  slug: 'oauth-app-review-management',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'OAuth app review',
    'zh-CN': 'OAuth 应用审核',
  },
  summary: {
    en: 'Find pending applications, check review permissions, approve or reject submissions, and understand deletion effects.',
    'zh-CN': '查找待审核应用，核对审核权限，完成通过或拒绝，并了解删除的影响。',
  },
  tags: ['oauth', 'review', 'approval', 'redirect-uri'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
