import contentEn from '@/content/en/auth-center-app-management.md?raw'
import contentZh from '@/content/zh-CN/auth-center-app-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  updatedAt: '2026-10-30',
  slug: 'auth-center-app-management',
  category: {
    en: 'Account',
    'zh-CN': '账号',
  },
  title: {
    en: 'Auth Center integration',
    'zh-CN': '认证中心应用接入',
  },
  summary: {
    en: 'Choose grants, obtain and refresh tokens, verify JWTs with wrapped JWKS, and confirm deployment endpoints.',
    'zh-CN': '选择授权方式，获取及刷新令牌，使用 JWKS 验证 JWT，并确认部署端点。',
  },
  tags: ['auth-center', 'jwt', 'jwks', 'refresh-token', 'application'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
