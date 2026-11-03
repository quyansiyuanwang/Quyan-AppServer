import contentEn from '@/content/en/node-sdk.md?raw'
import contentZh from '@/content/zh-CN/node-sdk.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'node-sdk',
  updatedAt: '2026-10-30',
  category: {
    en: 'Reference',
    'zh-CN': '参考',
  },
  title: {
    en: 'Node.js API example',
    'zh-CN': 'Node.js API 调用示例',
  },
  summary: {
    en: 'Run a complete Node.js API example with credential checks, timeouts, business errors, and request IDs.',
    'zh-CN': '运行完整 Node.js API 示例，处理凭证配置、超时、业务错误和请求 ID。',
  },
  tags: ['sdk', 'node', 'fetch', 'api', 'backend', '调用示例', '错误处理'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
