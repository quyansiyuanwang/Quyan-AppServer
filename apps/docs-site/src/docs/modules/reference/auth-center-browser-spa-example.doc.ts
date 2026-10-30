import contentEn from '@/content/en/auth-center-browser-spa-example.md?raw'
import contentZh from '@/content/zh-CN/auth-center-browser-spa-example.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'auth-center-browser-spa-example',
  updatedAt: '2026-10-30',
  category: {
    en: 'Reference',
    'zh-CN': '参考',
  },
  title: {
    en: 'Auth Center browser integration',
    'zh-CN': '认证中心浏览器接入',
  },
  summary: {
    en: 'Authorization and session guidance for browser-based Auth Center clients.',
    'zh-CN': '面向公共客户端的授权流程与浏览器会话说明。',
  },
  tags: ['auth-center', 'spa', 'browser', 'pkce', 'public-client'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
