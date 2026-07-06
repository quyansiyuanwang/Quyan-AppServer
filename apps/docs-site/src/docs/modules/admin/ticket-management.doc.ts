import contentEn from '@/content/en/ticket-management.md?raw'
import contentZh from '@/content/zh-CN/ticket-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'ticket-management',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'Ticket management',
    'zh-CN': '工单管理',
  },
  summary: {
    en: 'Review, prioritize, assign, and respond to user-submitted tickets and bug reports.',
    'zh-CN': '查看并处理用户提交的工单和 Bug 报告，支持优先级、分配与回复。',
  },
  tags: ['ticket', 'review', 'bug', 'suggestion'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
