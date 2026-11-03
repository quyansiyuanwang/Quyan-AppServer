import contentEn from '@/content/en/remote-terminal.md?raw'
import contentZh from '@/content/zh-CN/remote-terminal.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'remote-terminal',
  updatedAt: '2026-10-30',
  category: {
    en: 'Relay',
    'zh-CN': '转发',
  },
  title: {
    en: 'Remote terminal',
    'zh-CN': '远程终端',
  },
  summary: {
    en: 'Connect devices, manage terminal tabs and reconnection, and save opening locations and shortcuts.',
    'zh-CN': '连接设备，管理终端标签和重连，设置打开位置、快捷键和快捷命令。',
  },
  tags: ['remote', 'terminal', 'device', 'session', '重连', '打开位置', '快捷命令'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
