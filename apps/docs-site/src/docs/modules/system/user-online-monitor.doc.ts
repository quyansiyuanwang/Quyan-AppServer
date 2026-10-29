import contentEn from '@/content/en/user-online-monitor.md?raw'
import contentZh from '@/content/zh-CN/user-online-monitor.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'user-online-monitor',
  updatedAt: '2026-10-30',
  category: {
    en: 'System',
    'zh-CN': '系统',
  },
  title: {
    en: 'User online monitor',
    'zh-CN': '用户在线监控',
  },
  summary: {
    en: 'Find sessions, interpret online metrics, inspect user timelines, export records, and scope force-offline actions.',
    'zh-CN': '查找会话、理解在线统计、查看用户时间线、导出记录并确认强制下线范围。',
  },
  tags: ['session', 'online', 'monitor', 'force-offline', 'export'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
