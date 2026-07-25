import contentEn from '@/content/en/developer-product-secret.md?raw'
import contentZh from '@/content/zh-CN/developer-product-secret.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'
export default defineDocsPage({
  slug: 'developer-product-secret',
  category: { en: 'Developer Products', 'zh-CN': '开发者产品' },
  title: { en: 'Secret Vault API', 'zh-CN': '密钥托管 API' },
  summary: {
    en: 'Store aliases without exposing secret values.',
    'zh-CN': '保存别名而不暴露密钥明文。',
  },
  tags: ['secret'],
  content: { en: contentEn, 'zh-CN': contentZh },
})
