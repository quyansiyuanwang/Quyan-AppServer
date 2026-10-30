import contentEn from '@/content/en/access-key-management.md?raw'
import contentZh from '@/content/zh-CN/access-key-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'access-key-management',
  updatedAt: '2026-10-30',
  category: {
    en: 'Account',
    'zh-CN': '账号',
  },
  title: {
    en: 'Access key management',
    'zh-CN': '访问密钥管理',
  },
  summary: {
    en: 'Create and save account access keys, review authorized keys, and replace or revoke credentials.',
    'zh-CN': '创建并保存账号访问密钥，查看已授权密钥，并更换或撤销凭据。',
  },
  tags: ['access-key', 'security', 'key', 'iam'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
