import contentEn from '@/content/en/permission-management.md?raw'
import contentZh from '@/content/zh-CN/permission-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'permission-management',
  updatedAt: '2026-10-30',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'Permission management',
    'zh-CN': '权限管理',
  },
  summary: {
    en: 'Inspect permission sources, edit or clear user overrides, and understand IAM and hierarchy limits.',
    'zh-CN': '查看权限来源、编辑或清空用户覆盖项，了解 IAM 授权和等级限制。',
  },
  tags: ['permission', 'rbac', 'override', '授权', '权限', '诊断', '覆盖'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
