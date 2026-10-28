import contentEn from '@/content/en/oauth-demo.md?raw'
import contentZh from '@/content/zh-CN/oauth-demo.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'oauth-demo',
  updatedAt: '2026-10-29',
  category: {
    en: 'Reference',
    'zh-CN': '参考',
  },
  title: {
    en: 'OAuth Demo',
    'zh-CN': 'OAuth Demo',
  },
  summary: {
    en: 'Run an authorization-code flow with PKCE using a Node.js example.',
    'zh-CN': '使用 Node.js 示例体验授权码与 PKCE 流程。',
  },
  tags: ['oauth', 'demo', 'sequence', 'node', 'python'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
