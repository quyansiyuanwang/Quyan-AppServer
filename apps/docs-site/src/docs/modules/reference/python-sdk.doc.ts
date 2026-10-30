import contentEn from '@/content/en/python-sdk.md?raw'
import contentZh from '@/content/zh-CN/python-sdk.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'python-sdk',
  updatedAt: '2026-10-30',
  category: {
    en: 'Reference',
    'zh-CN': '参考',
  },
  title: {
    en: 'Python API example',
    'zh-CN': 'Python API 调用示例',
  },
  summary: {
    en: 'Run a complete Python API example with credential checks, HTTP and business errors, and timeout limits.',
    'zh-CN': '运行完整 Python API 示例，核对凭证、HTTP 与业务错误及超时范围。',
  },
  tags: ['sdk', 'python', 'requests', 'api', 'backend', '调用示例', '错误处理'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
