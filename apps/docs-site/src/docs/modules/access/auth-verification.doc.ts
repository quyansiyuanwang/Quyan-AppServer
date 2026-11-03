import contentEn from '@/content/en/auth-verification.md?raw'
import contentZh from '@/content/zh-CN/auth-verification.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'auth-verification',
  updatedAt: '2026-10-30',
  category: {
    en: 'Access',
    'zh-CN': '访问',
  },
  title: {
    en: 'Verification',
    'zh-CN': '验证页面',
  },
  summary: {
    en: 'Complete identity and captcha checks, choose a code method, and resolve verification failures.',
    'zh-CN': '完成身份与人机验证，选择验证码方式，并处理验证失败。',
  },
  tags: ['verification', '2fa', 'recovery-code'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
