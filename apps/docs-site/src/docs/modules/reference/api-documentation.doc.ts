import contentEn from '@/content/en/api-documentation.md?raw'
import contentZh from '@/content/zh-CN/api-documentation.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'api-documentation',
  updatedAt: '2026-10-30',
  category: {
    en: 'Reference',
    'zh-CN': '参考',
  },
  title: {
    en: 'API documentation',
    'zh-CN': 'API 文档',
  },
  summary: {
    en: 'Copy relay endpoints, compare model prices, and distinguish platform responses and protected OpenAPI access.',
    'zh-CN': '复制中转端点、比较模型价格，区分平台响应、凭证及 OpenAPI 访问权限。',
  },
  tags: ['api', 'reference', 'endpoint', 'swagger', 'pricing', '端点', '模型价格'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
