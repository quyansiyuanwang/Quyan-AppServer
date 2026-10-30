import contentEn from '@/content/en/server-configuration.md?raw'
import contentZh from '@/content/zh-CN/server-configuration.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  updatedAt: '2026-10-30',
  slug: 'server-configuration',
  category: {
    en: 'System',
    'zh-CN': '系统',
  },
  title: {
    en: 'Server configuration',
    'zh-CN': '服务端配置',
  },
  summary: {
    en: 'Read and save global settings, manage secrets, and verify security and capacity changes.',
    'zh-CN': '读取和保存全局配置、维护密钥，核对安全规则与 AI 容量设置。',
  },
  tags: ['server', 'config', 'smtp'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
