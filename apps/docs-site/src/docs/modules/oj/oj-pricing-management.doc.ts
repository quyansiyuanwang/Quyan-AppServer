import contentEn from '@/content/en/oj-pricing-management.md?raw'
import contentZh from '@/content/zh-CN/oj-pricing-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'oj-pricing-management',
  updatedAt: '2026-10-30',
  category: {
    en: 'OJ',
    'zh-CN': 'OJ',
  },
  title: {
    en: 'OJ pricing management',
    'zh-CN': 'OJ 价格管理',
  },
  summary: {
    en: 'Set model rates and cache multipliers, verify request costs, and understand pricing deletion limits.',
    'zh-CN': '设置模型单价和缓存倍率，核对请求费用，了解价格编辑与删除限制。',
  },
  tags: ['oj', 'pricing', 'model', '价格', '缓存', '倍率', '费用'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
