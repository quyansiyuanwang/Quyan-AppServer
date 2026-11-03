import contentEn from '@/content/en/ai-relay-quickstart.md?raw'
import contentZh from '@/content/zh-CN/ai-relay-quickstart.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'ai-relay-quickstart',
  updatedAt: '2026-10-30',
  category: { en: 'Relay', 'zh-CN': '转发' },
  title: { en: 'AI relay quick start', 'zh-CN': '调用 AI 快速开始' },
  summary: {
    en: 'Create and copy a Relay Token, select a supported format, make the first call, and verify usage and charges.',
    'zh-CN': '创建并复制中转令牌，选择支持格式、完成首次调用，并核对用量、费用和失败原因。',
  },
  tags: ['relay', 'ai', 'token', 'openai', 'responses', '快速开始', '首次调用'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
