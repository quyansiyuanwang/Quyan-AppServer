// Locale bundle: product-short_link/emoji.
import type en from './en'
import type { DeepStringify } from '@/types/common'

const emoji: DeepStringify<typeof en> = {
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
}

export default emoji
