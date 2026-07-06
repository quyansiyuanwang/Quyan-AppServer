import contentEn from '@/content/en/passkey-management.md?raw'
import contentZh from '@/content/zh-CN/passkey-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'passkey-management',
  category: {
    en: 'Account',
    'zh-CN': '账户',
  },
  title: {
    en: 'Passkey management',
    'zh-CN': '通行密钥管理',
  },
  summary: {
    en: 'Register, review, and remove passkeys used for passwordless sign-in.',
    'zh-CN': '注册、查看和移除用于无密码登录的通行密钥。',
  },
  tags: ['passkey', 'webauthn', 'security', '2fa'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
