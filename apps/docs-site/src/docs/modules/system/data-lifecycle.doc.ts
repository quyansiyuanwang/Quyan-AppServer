import contentEn from '@/content/en/data-lifecycle.md?raw'
import contentZh from '@/content/zh-CN/data-lifecycle.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'data-lifecycle',
  category: { en: 'System', 'zh-CN': '系统' },
  title: { en: 'Data archive and cleanup', 'zh-CN': '数据归档与清理' },
  summary: {
    en: 'Configure retention, inspect verified archives and control dataset and file access with IAM.',
    'zh-CN': '配置数据保留、查看已校验归档，并通过 IAM 控制数据集与文件访问。',
  },
  tags: ['archive', 'cleanup', 'oss', 'retention', 'iam', 'authorization'],
  updatedAt: '2026-10-13',
  content: { en: contentEn, 'zh-CN': contentZh },
})
