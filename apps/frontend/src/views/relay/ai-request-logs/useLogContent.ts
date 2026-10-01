import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type {
  AiRequestLogContentItemDto,
  AiRequestLogContentPageDto,
  AiRequestLogContentSide,
  AiRequestLogContentView,
} from '@/client/types.gen'
import { aiRequestLogService } from '@/service/aiRequestLogService'
import { getErrorMessage } from '@/utils/error-utils'
import { i18ns } from '@/locales'

export function useLogContent(
  source: () => {
    id: string
    side: AiRequestLogContentSide
    view: AiRequestLogContentView
    locator?: string
    offset?: number
  },
) {
  const items = shallowRef<AiRequestLogContentItemDto[]>([])
  const info = shallowRef<AiRequestLogContentPageDto | null>(null)
  const loading = ref(false)
  const error = ref('')
  const loadAll = ref(false)
  const allComplete = ref(false)
  const fullContents = shallowRef<Map<string, string>>(new Map())
  let generation = 0
  let controller: AbortController | null = null
  let allGeneration = 0
  const stopAll = () => {
    allGeneration++
    loadAll.value = false
  }
  const load = async (append = false) => {
    if (loading.value || (append && !info.value?.nextCursor)) return
    const version = generation
    controller = new AbortController()
    const signal = controller.signal
    loading.value = true
    error.value = ''
    try {
      const { id, ...params } = source()
      const result = await aiRequestLogService.content(
        id,
        { ...params, cursor: append ? (info.value?.nextCursor ?? undefined) : undefined },
        signal,
      )
      if (version !== generation || signal.aborted) return
      info.value = result
      items.value = append ? [...items.value, ...result.items] : result.items
    } catch (cause) {
      if (version === generation && !signal.aborted)
        error.value = getErrorMessage(cause, i18ns.t('aiRequestLogs.detailLoadFailed'))
    } finally {
      if (version === generation) loading.value = false
    }
  }
  const reset = async () => {
    generation++
    stopAll()
    controller?.abort()
    loading.value = false
    items.value = []
    info.value = null
    error.value = ''
    allComplete.value = false
    fullContents.value = new Map()
    if (source().id) await load()
  }
  const drain = async () => {
    const batch = ++allGeneration
    allComplete.value = false
    if (source().view === 'raw' && source().offset && items.value[0]?.offset) {
      controller = new AbortController()
      const signal = controller.signal
      const version = generation
      loading.value = true
      try {
        const { id, ...params } = source()
        const result = await aiRequestLogService.content(id, { ...params, offset: 0 }, signal)
        if (signal.aborted || version !== generation) return
        items.value = result.items
        info.value = result
      } catch (cause) {
        if (!signal.aborted)
          error.value = getErrorMessage(cause, i18ns.t('aiRequestLogs.detailLoadFailed'))
        return
      } finally {
        if (version === generation) loading.value = false
      }
    }
    while (loadAll.value && batch === allGeneration && info.value?.hasMore && !error.value) {
      await load(true)
      // Yield between pages; never combine all content into a blocking DOM/string operation.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    if (source().view === 'parsed') {
      for (const item of items.value) {
        let cursor: string | undefined
        let text = ''
        do {
          if (!loadAll.value || batch !== allGeneration || error.value) return
          controller = new AbortController()
          const signal = controller.signal
          const version = generation
          loading.value = true
          try {
            const result = await aiRequestLogService.content(
              source().id,
              { side: source().side, view: 'raw', locator: item.locator, cursor },
              signal,
            )
            if (signal.aborted || version !== generation) return
            text += result.items.map((segment) => segment.text).join('')
            cursor = result.nextCursor ?? undefined
          } catch (cause) {
            if (!signal.aborted && version === generation)
              error.value = getErrorMessage(cause, i18ns.t('aiRequestLogs.detailLoadFailed'))
            return
          } finally {
            if (version === generation) loading.value = false
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        } while (cursor)
        fullContents.value = new Map(fullContents.value).set(item.locator, text)
      }
    }
    if (loadAll.value && batch === allGeneration && !error.value) allComplete.value = true
  }
  watch(
    loadAll,
    (enabled) => {
      if (enabled) void drain()
      else {
        allGeneration++
        generation++
        controller?.abort()
        loading.value = false
      }
    },
    { flush: 'sync' },
  )
  watch(source, reset, { immediate: true })
  onBeforeUnmount(() => {
    generation++
    allGeneration++
    controller?.abort()
  })
  const retry = async () => {
    await load(Boolean(info.value?.hasMore))
    if (loadAll.value && !error.value) await drain()
  }
  return { items, info, loading, error, loadAll, allComplete, fullContents, load, reset, retry }
}
