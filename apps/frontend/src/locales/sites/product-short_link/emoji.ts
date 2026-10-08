// Locale bundle: product-short_link/emoji.
import type en from './en'
import type { DeepStringify } from '@/types/common'

const emoji = {
  shortLinkAnalytics: {
    back: '↩️ 🔗',
    title: '📊',
    timezone: '⏱️+8',
    description: '/{code} 👁️ 🌐 ↗️',
    refresh: '🔄',
    totalVisits: '🌐 👆',
    uniqueIps: '🪪 💬',
    periodVisits: '📅 👆',
    retention: '🗄️',
    retentionDays: '90 📅',
    dailyTrend: '📈 📅',
    hourlyTrend: '📈 ⏰',
    ipRanking: '💬 🏆',
    sourceRanking: '↗️ 🏆',
    topCount: '🏆 {count}',
    ipAddress: '💬',
    visitCount: '👆',
    sourceHost: '↗️ 🌐',
    directVisit: '➡️',
    unknown: '❔',
    visitDetails: '📋 👁️',
    recordCount: '{count} 📋',
    visitTime: '🕐',
    region: '🌍',
    source: '↗️',
    userAgent: '🖥️',
    loadFailed: '⚠️ 📊',
  },
} as const satisfies DeepStringify<typeof en>

export default emoji
