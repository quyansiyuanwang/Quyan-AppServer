import contentEn from '@/content/en/ai-relay-quickstart.md?raw'
import contentZh from '@/content/zh-CN/ai-relay-quickstart.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'ai-relay-quickstart',
  category: { en: 'Relay', 'zh-CN': '转发' },
  title: { en: 'AI relay quick start', 'zh-CN': '调用 AI 快速开始' },
  summary: {
    en: 'Create a Relay Token and make a compatible AI request.',
    'zh-CN': '创建中转令牌并发起兼容的 AI 请求。',
  },
  tags: ['relay', 'ai', 'token', 'openai'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
