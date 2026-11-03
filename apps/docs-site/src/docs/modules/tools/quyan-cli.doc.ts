import contentEn from '@/content/en/quyan-cli.md?raw'
import contentZh from '@/content/zh-CN/quyan-cli.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'quyan-cli',
  updatedAt: '2026-10-30',
  category: { en: 'Tools', 'zh-CN': '工具' },
  title: { en: 'Quyan CLI', 'zh-CN': 'Quyan CLI' },
  summary: {
    en: 'Install and verify the CLI, sign in, manage local credentials, and configure AI tools.',
    'zh-CN': '安装校验 CLI、登录和管理本地凭据，配置 AI 工具并访问 JSON 端点。',
  },
  tags: ['cli', 'relay', 'models', 'json-endpoints'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
