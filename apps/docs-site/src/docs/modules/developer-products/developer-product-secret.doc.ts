import contentEn from '@/content/en/developer-product-secret.md?raw'
import contentZh from '@/content/zh-CN/developer-product-secret.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({
  slug: 'developer-product-secret',
  category: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  title: { en: 'Secret Vault API', 'zh-CN': '密钥托管 API' },
  summary: {
    en: 'Write and rotate credentials, configure push references, and manage metadata permissions.',
    'zh-CN': '写入与轮换凭据、配置推送引用，并管理元数据及使用权限。',
  },
  tags: ['secret', 'rotation', 'push', 'permissions'],
  updatedAt: '2026-10-30',
  content: { en: contentEn, 'zh-CN': contentZh },
})
