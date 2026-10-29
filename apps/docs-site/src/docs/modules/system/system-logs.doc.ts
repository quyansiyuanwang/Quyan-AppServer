import contentEn from '@/content/en/system-logs.md?raw'
import contentZh from '@/content/zh-CN/system-logs.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'system-logs',
  category: {
    en: 'System',
    'zh-CN': '系统',
  },
  title: {
    en: 'System logs',
    'zh-CN': '系统日志',
  },
  summary: {
    en: 'Find API requests, interpret statistics, and search authorized server log files.',
    'zh-CN': '查找 API 请求、理解统计口径，并搜索获准的服务器日志文件。',
  },
  tags: ['logs', 'request', 'server', 'iam'],
  updatedAt: '2026-10-30',
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
