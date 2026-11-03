import contentEn from '@/content/en/auth-center-client-management.md?raw'
import contentZh from '@/content/zh-CN/auth-center-client-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  updatedAt: '2026-10-30',
  slug: 'auth-center-client-management',
  category: {
    en: 'Account',
    'zh-CN': '账号',
  },
  title: {
    en: 'Auth Center app management',
    'zh-CN': '认证中心应用管理',
  },
  summary: {
    en: 'Create your own applications, configure grants and lifetimes, submit for review, and manage client credentials.',
    'zh-CN': '创建自有应用，配置授权类型与有效期，提交审核并管理客户端凭据。',
  },
  tags: ['auth-center', 'application', 'review', 'pkce', 'jwks'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
