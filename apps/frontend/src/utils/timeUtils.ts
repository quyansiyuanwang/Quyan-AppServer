import type { Locale } from '@/locales'

export type TimeComponents = {
  days: number
  hours: number
  minutes: number
  seconds: number
}

export const getRemainingTime = (endTime: string, currentTime?: number): TimeComponents => {
  const now = currentTime ? new Date(currentTime) : new Date()
  const end = new Date(endTime)
  const diff = end.getTime() - now.getTime()

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((diff % (1000 * 60)) / 1000)

  return {
    days,
    hours,
    minutes,
    seconds,
  }
}

export const formatTime = (timeCom: TimeComponents, locale: Locale = 'en'): string => {
  const { days, hours, minutes, seconds } = timeCom

  const endedLabelMap: Record<Locale, string> = {
    en: 'Ended',
    'zh-CN': '已结束',
    emoji: '⏹️',
  }

  const dayLabelMap: Record<Locale, string> = {
    en: 'days',
    'zh-CN': '天',
    emoji: '📅',
  }

  // 如果所有时间组件都小于等于0，表示已结束
  if (days <= 0 && hours <= 0 && minutes <= 0 && seconds <= 0) {
    return endedLabelMap[locale]
  }

  const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  if (days > 0) {
    const daysLabel = dayLabelMap[locale]
    return `${timeString} + ${days}${daysLabel}`
  }

  return timeString
}

export const formatDateTime = (dateTime: string | undefined): string => {
  if (!dateTime) return '-'
  const date = new Date(dateTime)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export const formatDuration = (duration: number): string => {
  const hours = Math.floor(duration / 3600)
  const minutes = Math.floor((duration % 3600) / 60)
  const seconds = duration % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
