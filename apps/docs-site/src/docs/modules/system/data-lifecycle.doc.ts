import contentEn from '@/content/en/data-lifecycle.md?raw'
import contentZh from '@/content/zh-CN/data-lifecycle.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'data-lifecycle',
  category: { en: 'System', 'zh-CN': '系统' },
  title: { en: 'Data archive and cleanup', 'zh-CN': '数据归档与清理' },
  summary: {
    en: 'Configure hot-data retention and inspect verified OSS archives.',
    'zh-CN': '配置热数据保留并查看已校验的 OSS 归档。',
  },
  tags: ['archive', 'cleanup', 'oss', 'retention'],
  updatedAt: '2026-08-09',
  content: { en: contentEn, 'zh-CN': contentZh },
})
