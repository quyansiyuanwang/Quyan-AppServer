import contentEn from '@/content/en/article-management.md?raw'
import contentZh from '@/content/zh-CN/article-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'article-management',
  updatedAt: '2026-10-30',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'Article management',
    'zh-CN': '文章管理',
  },
  summary: {
    en: 'Save drafts, publish articles, control reader access, and set reading order and the site default.',
    'zh-CN': '保存草稿、发布文章、设置阅读范围，并管理排序与全站默认文章。',
  },
  tags: ['article', 'editor', 'draft', 'publish', 'default', 'iam'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
