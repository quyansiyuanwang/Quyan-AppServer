import contentEn from '@/content/en/getting-started.md?raw'
import contentZh from '@/content/zh-CN/getting-started.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'getting-started',
  updatedAt: '2026-10-31',
  category: {
    en: 'Intro',
    'zh-CN': '入门',
  },
  title: {
    en: 'User manual',
    'zh-CN': '用户手册',
  },
  summary: {
    en: 'Find the right console and documentation for your task.',
    'zh-CN': '了解如何选择控制台并找到所需的操作说明。',
  },
  tags: ['manual', 'search', 'index'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
