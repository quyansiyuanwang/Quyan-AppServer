import contentEn from '@/content/en/legal-policy-management.md?raw'
import contentZh from '@/content/zh-CN/legal-policy-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'legal-policy-management',
  updatedAt: '2026-10-30',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'Legal policy management',
    'zh-CN': '法律政策管理',
  },
  summary: {
    en: 'Create policy drafts, publish current versions, manage fallbacks, and understand login consent.',
    'zh-CN': '创建协议草稿、发布生效版本，了解历史回退、登录同意和权限要求。',
  },
  tags: ['legal', 'policy', 'privacy', 'consent', '协议', '隐私', '发布', '同意'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
