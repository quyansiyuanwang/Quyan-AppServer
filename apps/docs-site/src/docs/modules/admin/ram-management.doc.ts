import contentEn from '@/content/en/ram-management.md?raw'
import contentZh from '@/content/zh-CN/ram-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'ram-management',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'RAM management',
    'zh-CN': 'RAM 资源访问管理',
  },
  summary: {
    en: 'Manage RAM users, roles, permission policies, bindings, role sessions, and view effective permissions.',
    'zh-CN': '管理 RAM 用户、角色、权限策略、绑定、角色会话，查看有效权限。',
  },
  tags: ['ram', 'role', 'policy', 'permission', 'admin', 'access-control'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
