import contentEn from '@/content/en/my-feedback.md?raw'
import contentZh from '@/content/zh-CN/my-feedback.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'my-feedback',
  category: {
    en: 'Account',
    'zh-CN': '账号',
  },
  title: {
    en: 'My feedback',
    'zh-CN': '我的反馈',
  },
  summary: {
    en: 'Submit feedback, bug reports, and suggestions, and track their review status.',
    'zh-CN': '提交反馈、建议与 Bug 报告，并查看处理进度。',
  },
  tags: ['feedback', 'suggestion', 'bug', 'support'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
