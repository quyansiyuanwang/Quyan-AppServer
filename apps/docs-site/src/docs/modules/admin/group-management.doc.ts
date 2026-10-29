import contentEn from '@/content/en/group-management.md?raw'
import contentZh from '@/content/zh-CN/group-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'group-management',
  updatedAt: '2026-10-30',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'Group management',
    'zh-CN': '群组管理',
  },
  summary: {
    en: 'Find and create groups, apply level rules, edit permission sets, and handle deletion restrictions.',
    'zh-CN': '查找和创建群组，了解等级规则、权限集合保存和删除限制。',
  },
  tags: ['group', 'permission', 'admin', '群组', '等级', '权限', '委派'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
