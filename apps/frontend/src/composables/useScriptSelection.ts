import { computed, ref } from 'vue'

export interface SelectableScript {
  id: string
}

export function useScriptSelection<T extends SelectableScript>(
  scriptList: () => T[],
  pageSize = 10,
) {
  const selectedIds = ref<Set<string>>(new Set())
  const lastClickedId = ref<string | null>(null)
  const currentPage = ref(1)

  const paginatedList = computed(() => {
    const start = (currentPage.value - 1) * pageSize
    return scriptList().slice(start, start + pageSize)
  })

  const allSelected = computed(
    () => scriptList().length > 0 && scriptList().every((s) => selectedIds.value.has(s.id)),
  )

  const someSelected = computed(() => selectedIds.value.size > 0 && !allSelected.value)

  function toggleSelect(script: T, event: MouseEvent) {
    if (event.shiftKey) {
      event.preventDefault()
    }
    const lastId = lastClickedId.value
    if (event.shiftKey && lastId) {
      const ids = scriptList().map((s) => s.id)
      const lastIdx = ids.indexOf(lastId)
      const currIdx = ids.indexOf(script.id)
      if (lastIdx >= 0 && currIdx >= 0) {
        const start = Math.min(lastIdx, currIdx)
        const end = Math.max(lastIdx, currIdx)
        const next = new Set(selectedIds.value)
        for (let i = start; i <= end; i++) next.add(ids[i]!)
        selectedIds.value = next
        return
      }
    }
    const next = new Set(selectedIds.value)
    if (next.has(script.id)) next.delete(script.id)
    else next.add(script.id)
    selectedIds.value = next
    lastClickedId.value = script.id
  }

  function toggleSelectAll() {
    if (allSelected.value) {
      selectedIds.value = new Set()
      lastClickedId.value = null
    } else {
      selectedIds.value = new Set(scriptList().map((s) => s.id))
    }
  }

  function clearSelection() {
    selectedIds.value = new Set()
    lastClickedId.value = null
  }

  function resetPage() {
    currentPage.value = 1
  }

  return {
    selectedIds,
    lastClickedId,
    currentPage,
    pageSize,
    paginatedList,
    allSelected,
    someSelected,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    resetPage,
  }
}
