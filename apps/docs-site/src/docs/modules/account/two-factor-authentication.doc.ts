import contentEn from '@/content/en/two-factor-authentication.md?raw'
import contentZh from '@/content/zh-CN/two-factor-authentication.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'two-factor-authentication',
  category: {
    en: 'Account',
    'zh-CN': '账户',
  },
  title: {
    en: '2FA & passkeys',
    'zh-CN': '两步验证与通行密钥',
  },
  summary: {
    en: 'Enable TOTP-based 2FA, manage recovery codes, register passkeys, and review trusted devices.',
    'zh-CN': '启用 TOTP 两步验证、管理恢复代码、注册通行密钥、管理受信任设备。',
  },
  tags: ['2fa', 'passkey', 'security', 'totp', 'trusted-device', 'recovery-code'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
