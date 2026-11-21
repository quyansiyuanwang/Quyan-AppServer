import contentEn from '@/content/en/quyan-cli.md?raw'
import contentZh from '@/content/zh-CN/quyan-cli.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'quyan-cli',
  updatedAt: '2026-11-19',
  category: { en: 'Tools', 'zh-CN': '工具' },
  title: { en: 'Quyan CLI', 'zh-CN': 'Quyan CLI' },
  summary: {
    en: 'Use the compact customer console, manage tokens, configure AI tools, and route models locally.',
    'zh-CN': '使用简洁客户控制台管理令牌、配置 AI 工具和本地模型路由。',
  },
  tags: ['cli', 'relay', 'models', 'json-endpoints'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
