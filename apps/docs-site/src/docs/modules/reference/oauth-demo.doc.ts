import contentEn from '@/content/en/oauth-demo.md?raw'
import contentZh from '@/content/zh-CN/oauth-demo.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'oauth-demo',
  updatedAt: '2026-10-30',
  category: {
    en: 'Reference',
    'zh-CN': '参考',
  },
  title: {
    en: 'OAuth authorization-code example',
    'zh-CN': 'OAuth 授权码示例',
  },
  summary: {
    en: 'Run a local Node.js authorization-code example with PKCE, one-time callbacks, and token and profile checks.',
    'zh-CN': '运行本地 Node.js 授权码与 PKCE 示例，核对一次性回调、令牌和用户资料响应。',
  },
  tags: ['oauth', 'authorization-code', 'pkce', 'node', 'callback'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
