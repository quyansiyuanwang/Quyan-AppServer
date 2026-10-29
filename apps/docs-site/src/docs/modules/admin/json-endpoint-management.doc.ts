import contentEn from '@/content/en/json-endpoint-management.md?raw'
import contentZh from '@/content/zh-CN/json-endpoint-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'json-endpoint-management',
  updatedAt: '2026-10-30',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'JSON endpoint management',
    'zh-CN': 'JSON 端点管理',
  },
  summary: {
    en: 'Create and edit shared JSON, configure password or signature access, and delegate management.',
    'zh-CN': '创建与编辑 JSON 分享端点，配置密码或签名保护，并委派管理权限。',
  },
  tags: ['json', 'endpoint', 'publish'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
