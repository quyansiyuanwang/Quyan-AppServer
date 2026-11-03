import contentEn from '@/content/en/oauth-app-management.md?raw'
import contentZh from '@/content/zh-CN/oauth-app-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  updatedAt: '2026-10-30',
  slug: 'oauth-app-management',
  category: {
    en: 'Account',
    'zh-CN': '账号',
  },
  title: {
    en: 'OAuth app management',
    'zh-CN': 'OAuth 应用管理',
  },
  summary: {
    en: 'Register applications, submit for review, manage callbacks, and handle secret rotation and issued tokens.',
    'zh-CN': '注册应用、提交审核、配置回调地址，并了解密钥轮换及已签发令牌的处理。',
  },
  tags: ['oauth', 'application', 'client'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
