import contentEn from '@/content/en/script-manager.md?raw'
import contentZh from '@/content/zh-CN/script-manager.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'script-manager',
  updatedAt: '2026-10-30',
  category: {
    en: 'Tools',
    'zh-CN': '工具',
  },
  title: {
    en: 'Script manager',
    'zh-CN': '脚本管理',
  },
  summary: {
    en: 'Create and save JavaScript scripts, run or stop them, and check output and saved history.',
    'zh-CN': '创建和保存 JavaScript 脚本、运行与停止执行，查看输出和已保存历史。',
  },
  tags: ['script', 'automation', 'execution'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
