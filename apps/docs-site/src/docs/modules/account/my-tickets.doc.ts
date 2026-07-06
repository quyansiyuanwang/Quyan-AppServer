import contentEn from '@/content/en/my-tickets.md?raw'
import contentZh from '@/content/zh-CN/my-tickets.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'my-tickets',
  category: {
    en: 'Account',
    'zh-CN': '账号',
  },
  title: {
    en: 'My tickets',
    'zh-CN': '我的工单',
  },
  summary: {
    en: 'Submit tickets, bug reports, and suggestions, and track their review status.',
    'zh-CN': '提交工单、建议与 Bug 报告，并查看处理进度。',
  },
  tags: ['ticket', 'suggestion', 'bug', 'support'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
