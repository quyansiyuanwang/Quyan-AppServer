import contentEn from '@/content/en/upstream-status.md?raw'
import contentZh from '@/content/zh-CN/upstream-status.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'upstream-status',
  updatedAt: '2026-10-30',
  category: {
    en: 'Relay',
    'zh-CN': '转发',
  },
  title: {
    en: 'Upstream status',
    'zh-CN': '上游状态',
  },
  summary: {
    en: 'Check visible upstream monitors and distinguish current status, uptime, and latency.',
    'zh-CN': '查看可见上游监控，区分当前状态、在线率和延迟，并排查数据异常。',
  },
  tags: ['upstream', 'status', 'monitoring'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
