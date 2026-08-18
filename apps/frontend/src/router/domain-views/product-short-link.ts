import type { Component } from 'vue'

export default import.meta.glob<Component>(
  '../../views/products/short-link/{ShortLinkUserPage,ShortLinkAnalyticsPage}.vue',
  { eager: true, import: 'default' },
)
