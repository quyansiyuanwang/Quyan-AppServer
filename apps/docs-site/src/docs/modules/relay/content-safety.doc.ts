import contentEn from '@/content/en/content-safety.md?raw'
import contentZh from '@/content/zh-CN/content-safety.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'content-safety',
  category: { en: 'Relay', 'zh-CN': '转发' },
  title: { en: 'Content safety', 'zh-CN': '内容安全' },
  summary: {
    en: 'Manage scoped content safety policies, rules, imports, and exports.',
    'zh-CN': '管理分级内容安全策略、规则、导入和导出。',
  },
  tags: ['relay', 'content safety', 'security'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
