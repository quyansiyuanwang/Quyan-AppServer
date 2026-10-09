// Locale bundle: product-short_link/zh-CN.
import type en from './en'
import type { DeepStringify } from '@/types/common'

const zhCN = {
  shortLinkAnalytics: {
    back: '返回短链接',
    title: '访问分析',
    timezone: 'UTC+8',
    description: '/{code} 的访问、访客与来源明细',
    refresh: '刷新',
    totalVisits: '累计访问',
    uniqueIps: '独立 IP',
    periodVisits: '统计周期访问',
    retention: '记录保留',
    retentionDays: '90 天',
    dailyTrend: '按日访问趋势',
    hourlyTrend: '按小时访问分布',
    ipRanking: '访问 IP',
    sourceRanking: '访问来源',
    topCount: '前 {count} 名',
    ipAddress: 'IP 地址',
    visitCount: '访问次数',
    sourceHost: '来源域名',
    directVisit: '直接访问',
    unknown: '未知',
    visitDetails: '访问明细',
    recordCount: '{count} 条记录',
    visitTime: '访问时间',
    region: '地区',
    source: '来源',
    userAgent: 'User-Agent',
    loadFailed: '无法加载短链接访问分析',
  },
} as const satisfies DeepStringify<typeof en>

export default zhCN
