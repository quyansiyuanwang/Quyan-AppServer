import contentEn from '@/content/en/account-settings.md?raw'
import contentZh from '@/content/zh-CN/account-settings.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'account-settings',
  updatedAt: '2026-10-30',
  category: {
    en: 'Account',
    'zh-CN': '账号',
  },
  title: {
    en: 'Settings',
    'zh-CN': '设置',
  },
  summary: {
    en: 'Update your profile, email and password, manage external account bindings, and clear selected local data.',
    'zh-CN': '修改资料、邮箱和密码，管理外部账号绑定，并按项清理本地数据。',
  },
  tags: ['settings', 'profile', 'security'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
