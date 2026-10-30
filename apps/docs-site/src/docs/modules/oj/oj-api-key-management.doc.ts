import contentEn from '@/content/en/oj-api-key-management.md?raw'
import contentZh from '@/content/zh-CN/oj-api-key-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'oj-api-key-management',
  updatedAt: '2026-10-30',
  category: {
    en: 'OJ',
    'zh-CN': 'OJ',
  },
  title: {
    en: 'OJ API key management',
    'zh-CN': 'OJ API Key 管理',
  },
  summary: {
    en: 'Create and rotate OJ keys, configure expiry and channels, and control credential disclosure.',
    'zh-CN': '创建和轮换 OJ 密钥，设置到期时间与渠道，了解凭据披露和用量范围。',
  },
  tags: ['oj', 'api-key', 'submitter', '密钥', '渠道', '到期', '凭据'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
