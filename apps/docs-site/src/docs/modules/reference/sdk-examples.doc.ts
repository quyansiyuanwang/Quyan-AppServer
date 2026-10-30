import contentEn from '@/content/en/sdk-examples.md?raw'
import contentZh from '@/content/zh-CN/sdk-examples.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'sdk-examples',
  updatedAt: '2026-10-30',
  category: {
    en: 'Reference',
    'zh-CN': '参考',
  },
  title: {
    en: 'SDK & Examples',
    'zh-CN': 'SDK 与示例',
  },
  summary: {
    en: 'Choose platform API, OAuth, Auth Center, browser SPA, or AI relay examples and verify the integration.',
    'zh-CN': '按平台 API、OAuth、认证中心、浏览器或 AI 中转任务选择示例并验证接入。',
  },
  tags: ['sdk', 'example', 'oauth', 'node', 'python', 'auth-center', '接入', '示例'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
