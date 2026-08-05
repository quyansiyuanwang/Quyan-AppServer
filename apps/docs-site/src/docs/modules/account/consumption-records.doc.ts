import contentEn from '@/content/en/consumption-records.md?raw'
import contentZh from '@/content/zh-CN/consumption-records.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'consumption-records',
  category: {
    en: 'Account',
    'zh-CN': '账号',
  },
  title: {
    en: 'Consumption records',
    'zh-CN': '消费记录',
  },
  summary: {
    en: 'Review usage quota, request throughput, and filtered API consumption records.',
    'zh-CN': '查看已使用额度、请求吞吐指标和可筛选的 API 消费记录。',
  },
  tags: ['consumption', 'usage', 'quota', 'api', 'transaction'],
  updatedAt: '2026-08-05',
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
