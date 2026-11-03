import contentEn from '@/content/en/user-management.md?raw'
import contentZh from '@/content/zh-CN/user-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'user-management',
  updatedAt: '2026-10-30',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'User management',
    'zh-CN': '用户管理',
  },
  summary: {
    en: 'Find and create users, edit profiles and status, reset passwords, and use account impersonation.',
    'zh-CN': '查找和创建用户、编辑资料与状态、重置密码，了解账户模拟和 IAM 限制。',
  },
  tags: ['user', 'admin', 'account', '用户', '密码', '禁用', '模拟', 'impersonation'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
