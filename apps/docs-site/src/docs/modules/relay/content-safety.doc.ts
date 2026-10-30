import contentEn from '@/content/en/content-safety.md?raw'
import contentZh from '@/content/zh-CN/content-safety.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'content-safety',
  category: { en: 'Relay', 'zh-CN': '转发' },
  title: { en: 'Content safety', 'zh-CN': '内容安全' },
  summary: {
    en: 'Configure content safety rules, inheritance, AI audit costs, streaming behavior, and incident review.',
    'zh-CN': '配置内容安全规则与继承，了解 AI 审计费用、流式处理和命中记录。',
  },
  tags: ['relay', 'content safety', 'security'],
  updatedAt: '2026-10-30',
  content: { en: contentEn, 'zh-CN': contentZh },
})
