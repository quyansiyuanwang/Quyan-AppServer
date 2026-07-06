import contentEn from '@/content/en/trusted-device-management.md?raw'
import contentZh from '@/content/zh-CN/trusted-device-management.md?raw'
import { defineDocsPage } from '@/docs/defineDocsPage'

export default defineDocsPage({
  slug: 'trusted-device-management',
  category: {
    en: 'Account',
    'zh-CN': '账户',
  },
  title: {
    en: 'Trusted devices',
    'zh-CN': '受信任设备管理',
  },
  summary: {
    en: 'Review devices that can skip repeated 2FA verification within their trust window, and remove any you no longer trust.',
    'zh-CN': '查看在信任窗口期内可跳过重复验证的设备，并移除不再信任的设备。',
  },
  tags: ['trusted-device', 'security', '2fa', 'trusted-window'],
  content: {
    en: contentEn,
    'zh-CN': contentZh,
  },
})
