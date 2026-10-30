import contentEn from '@/content/en/notification-settings.md?raw'
import contentZh from '@/content/zh-CN/notification-settings.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'notification-settings',
  updatedAt: '2026-10-30',
  category: {
    en: 'Account',
    'zh-CN': '账号',
  },
  title: {
    en: 'Notification settings',
    'zh-CN': '通知设置',
  },
  summary: {
    en: 'Configure event subscriptions, test saved destinations, and review inbox and delivery results.',
    'zh-CN': '配置事件订阅、测试已保存的通知目标，并查看站内消息和投递结果。',
  },
  tags: ['notification', 'email', 'webhook'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
