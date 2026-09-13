import contentEn from '@/content/en/carpool-management.md?raw'
import contentZh from '@/content/zh-CN/carpool-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'carpool-management',
  category: {
    en: 'Admin',
    'zh-CN': '管理',
  },
  title: {
    en: 'Carpool operations',
    'zh-CN': '拼车运营管理',
  },
  summary: {
    en: 'Configure packages and safely accept, deliver, or refund carpool orders.',
    'zh-CN': '说明拼车套餐配置、受理、受控交付和失败退款。',
  },
  tags: ['carpool', 'operations', 'delivery', 'refund'],
  updatedAt: '2026-09-13',
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
