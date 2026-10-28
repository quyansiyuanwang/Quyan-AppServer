import { reactive, ref } from 'vue'
import type { RemoteTerminalFilterOptionsDto } from '@/client/types.gen'

type OptionsSource = {
  getFilterOptions(params: {
    page: number
    pageSize: number
    keyword?: string
  }): Promise<RemoteTerminalFilterOptionsDto>
}
const OPTIONS_PAGE_SIZE = 20

/** A page contains only server-admitted options, and never survives an identity or request change. */
export function useRemoteTerminalTemplateOptions(source: OptionsSource, identity: () => string) {
  const filterOptions = reactive<RemoteTerminalFilterOptionsDto>({
    templateStatusOptions: [],
    assignmentStatusOptions: [],
    deviceStatusOptions: [],
    publishStatusOptions: [],
    templates: [],
  })
  const page = ref(1),
    total = ref(0),
    keyword = ref(''),
    loading = ref(false),
    failed = ref(false)
  let generation = 0
  const clear = () => {
    filterOptions.templateStatusOptions = []
    filterOptions.assignmentStatusOptions = []
    filterOptions.deviceStatusOptions = []
    filterOptions.publishStatusOptions = []
    filterOptions.templates = []
    filterOptions.templateTotal = undefined
    filterOptions.templatePage = undefined
    filterOptions.templatePageSize = undefined
    total.value = 0
  }
  const reset = () => {
    generation++
    clear()
    page.value = 1
    keyword.value = ''
    loading.value = false
    failed.value = false
  }
  const load = async (nextPage = 1, search = keyword.value) => {
    const attempt = ++generation,
      owner = identity()
    const current = () => attempt === generation && owner === identity()
    clear()
    loading.value = true
    failed.value = false
    page.value = nextPage
    keyword.value = search.trim()
    try {
      if (!Number.isSafeInteger(nextPage) || nextPage < 1) throw new Error('Invalid option page')
      const result = await source.getFilterOptions({
        page: nextPage,
        pageSize: OPTIONS_PAGE_SIZE,
        keyword: keyword.value || undefined,
      })
      if (!current()) return false
      if (
        result.templatePage !== nextPage ||
        result.templatePageSize !== OPTIONS_PAGE_SIZE ||
        !Number.isSafeInteger(result.templateTotal) ||
        result.templateTotal! < 0 ||
        !Array.isArray(result.templates) ||
        result.templates.length > OPTIONS_PAGE_SIZE ||
        new Set(result.templates.map((row) => row.id)).size !== result.templates.length ||
        result.templates.some((row) => !row.id || typeof row.name !== 'string') ||
        (result.templates.length &&
          result.templateTotal! < (nextPage - 1) * OPTIONS_PAGE_SIZE + result.templates.length)
      )
        throw new Error('Invalid template option response')
      Object.assign(filterOptions, result)
      total.value = result.templateTotal!
      return true
    } catch {
      if (current()) {
        clear()
        failed.value = true
      }
      return false
    } finally {
      if (attempt === generation) {
        loading.value = false
        if (owner !== identity()) clear()
      }
    }
  }
  return {
    filterOptions,
    page,
    total,
    keyword,
    loading,
    failed,
    pageSize: OPTIONS_PAGE_SIZE,
    load,
    reset,
  }
}
