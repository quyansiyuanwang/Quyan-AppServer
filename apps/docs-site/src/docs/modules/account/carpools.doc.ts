import contentEn from '@/content/en/carpools.md?raw'
import contentZh from '@/content/zh-CN/carpools.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'carpools',
  category: {
    en: 'Account',
    'zh-CN': '账号',
  },
  title: {
    en: 'Carpools',
    'zh-CN': '拼车',
  },
  summary: {
    en: 'Create private invitation-only carpools, allocate shares, and follow delivery.',
    'zh-CN': '说明私有邀请制拼车、份额确认和交付流程。',
  },
  tags: ['carpool', 'monthly-pass', 'invitation', 'quota'],
  updatedAt: '2026-09-13',
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
