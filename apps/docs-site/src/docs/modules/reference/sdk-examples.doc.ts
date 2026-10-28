import contentEn from '@/content/en/sdk-examples.md?raw'
import contentZh from '@/content/zh-CN/sdk-examples.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'sdk-examples',
  updatedAt: '2026-10-29',
  category: {
    en: 'Reference',
    'zh-CN': '参考',
  },
  title: {
    en: 'SDK & Examples',
    'zh-CN': 'SDK 与示例',
  },
  summary: {
    en: 'Choose API, OAuth, and Auth Center integration examples.',
    'zh-CN': '按 API 调用、OAuth 或认证中心接入场景选择示例。',
  },
  tags: ['sdk', 'example', 'oauth', 'node', 'python'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
