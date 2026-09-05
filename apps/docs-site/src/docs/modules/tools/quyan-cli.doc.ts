import contentEn from '@/content/en/quyan-cli.md?raw'
import contentZh from '@/content/zh-CN/quyan-cli.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'quyan-cli',
  category: { en: 'Tools', 'zh-CN': '工具' },
  title: { en: 'Quyan CLI', 'zh-CN': 'Quyan CLI' },
  summary: {
    en: 'Install, authenticate, and use the Quyan terminal client.',
    'zh-CN': '安装、认证并使用 Quyan 终端客户端。',
  },
  tags: ['cli', 'relay', 'json-endpoints'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
