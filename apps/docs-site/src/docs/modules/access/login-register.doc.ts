import contentEn from '@/content/en/login-register.md?raw'
import contentZh from '@/content/zh-CN/login-register.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'login-register',
  updatedAt: '2026-10-30',
  category: {
    en: 'Access',
    'zh-CN': '访问',
  },
  title: {
    en: 'Login / Register',
    'zh-CN': '登录 / 注册',
  },
  summary: {
    en: 'Register an account, choose a sign-in method, and troubleshoot authentication or browser problems.',
    'zh-CN': '注册账号、选择登录方式，并排查认证或浏览器问题。',
  },
  tags: ['login', 'register', 'passkey', 'qr', 'repair'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
