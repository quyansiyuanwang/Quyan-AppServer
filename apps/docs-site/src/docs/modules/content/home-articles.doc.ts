import contentEn from '@/content/en/home-articles.md?raw'
import contentZh from '@/content/zh-CN/home-articles.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'home-articles',
  updatedAt: '2026-10-30',
  category: {
    en: 'Content',
    'zh-CN': '内容',
  },
  title: {
    en: 'Home / Articles',
    'zh-CN': '首页 / 文章',
  },
  summary: {
    en: 'Find and read published articles, use section navigation, and resolve loading problems.',
    'zh-CN': '查找与阅读已发布文章、使用章节目录，并处理文章加载问题。',
  },
  tags: ['home', 'article', 'knowledge'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
