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
    en: 'Inspect API request details and server logs with file-specific IAM permissions.',
    'zh-CN': '说明 API 请求日志和服务端日志的文件级 IAM 权限。',
  },
  tags: ['logs', 'request', 'server', 'iam'],
  updatedAt: '2026-10-14',
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
