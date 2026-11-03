import contentEn from '@/content/en/data-lifecycle.md?raw'
import contentZh from '@/content/zh-CN/data-lifecycle.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'data-lifecycle',
  category: { en: 'System', 'zh-CN': '系统' },
  title: { en: 'Data archive and cleanup', 'zh-CN': '数据归档与清理' },
  summary: {
    en: 'Set retention, archive hot data, download verified files, and safely preview imports and table maintenance.',
    'zh-CN': '设置保留策略、归档热数据与下载文件，按预览执行历史导入和表维护。',
  },
  tags: ['archive', 'cleanup', 'oss', 'retention', 'iam', 'authorization'],
  updatedAt: '2026-10-30',
  content: { en: contentEn, 'zh-CN': contentZh },
})
