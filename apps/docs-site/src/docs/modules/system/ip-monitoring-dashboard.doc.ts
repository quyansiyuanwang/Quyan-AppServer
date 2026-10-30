import contentEn from '@/content/en/ip-monitoring-dashboard.md?raw'
import contentZh from '@/content/zh-CN/ip-monitoring-dashboard.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'ip-monitoring-dashboard',
  updatedAt: '2026-10-30',
  category: {
    en: 'System',
    'zh-CN': '系统',
  },
  title: {
    en: 'IP monitoring dashboard',
    'zh-CN': 'IP 监控面板',
  },
  summary: {
    en: 'Query IP error weights, resolve bans, manage whitelist exemptions, and understand refresh and IAM limits.',
    'zh-CN': '查询 IP 错误权重、处理误封、维护白名单豁免，并了解刷新与 IAM 权限范围。',
  },
  tags: ['ip', 'monitoring', 'blacklist', 'whitelist', 'decay', 'iam'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
