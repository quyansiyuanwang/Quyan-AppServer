import contentEn from '@/content/en/api-documentation.md?raw'
import contentZh from '@/content/zh-CN/api-documentation.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'api-documentation',
  updatedAt: '2026-11-23',
  category: {
    en: 'Reference',
    'zh-CN': '参考',
  },
  title: {
    en: 'API documentation',
    'zh-CN': 'API 文档',
  },
  summary: {
    en: 'Copy relay endpoints, compare model prices and channel mappings, find token mapping previews, and understand platform responses and protected OpenAPI access.',
    'zh-CN':
      '复制中转端点、比较模型价格与渠道映射、查找 Token 映射预览，了解平台响应、凭证及 OpenAPI 访问权限。',
  },
  tags: [
    'api',
    'reference',
    'endpoint',
    'swagger',
    'pricing',
    'model mapping',
    '端点',
    '模型价格',
    '模型映射',
  ],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
