// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { useScriptSelection } from '@/composables/useScriptSelection'

function makeScript(id: string) {
  return { id }
}

function makeEvent(opts: Partial<MouseEventInit> = {}): MouseEvent {
  return new MouseEvent('click', opts)
}

// ─── pagination ──────────────────────────────────────────────────────────────

describe('paginatedList', () => {
  it('returns first page slice when on page 1', () => {
    const scripts = Array.from({ length: 25 }, (_, i) => makeScript(`s${i}`))
    const { paginatedList } = useScriptSelection(() => scripts, 10)
    expect(paginatedList.value).toHaveLength(10)
    expect(paginatedList.value[0].id).toBe('s0')
    expect(paginatedList.value[9].id).toBe('s9')
  })

  it('returns second page slice when currentPage is 2', () => {
    const scripts = Array.from({ length: 25 }, (_, i) => makeScript(`s${i}`))
    const { paginatedList, currentPage } = useScriptSelection(() => scripts, 10)
    currentPage.value = 2
    expect(paginatedList.value).toHaveLength(10)
    expect(paginatedList.value[0].id).toBe('s10')
  })

  it('returns partial last page', () => {
    const scripts = Array.from({ length: 25 }, (_, i) => makeScript(`s${i}`))
    const { paginatedList, currentPage } = useScriptSelection(() => scripts, 10)
    currentPage.value = 3
    expect(paginatedList.value).toHaveLength(5)
    expect(paginatedList.value[0].id).toBe('s20')
  })

  it('returns all scripts when fewer than page size', () => {
    const scripts = [makeScript('a'), makeScript('b')]
    const { paginatedList } = useScriptSelection(() => scripts, 10)
    expect(paginatedList.value).toHaveLength(2)
  })

  it('resets to page 1 via resetPage()', () => {
    const scripts = Array.from({ length: 25 }, (_, i) => makeScript(`s${i}`))
    const { currentPage, resetPage } = useScriptSelection(() => scripts, 10)
    currentPage.value = 3
    resetPage()
    expect(currentPage.value).toBe(1)
  })
})

// ─── allSelected / someSelected ──────────────────────────────────────────────

describe('allSelected / someSelected', () => {
  it('allSelected is false when list is empty', () => {
    const { allSelected } = useScriptSelection(() => [])
    expect(allSelected.value).toBe(false)
  })

  it('allSelected is false when none are selected', () => {
    const { allSelected } = useScriptSelection(() => [makeScript('a'), makeScript('b')])
    expect(allSelected.value).toBe(false)
  })

  it('allSelected is true when every script is selected', () => {
    const scripts = [makeScript('a'), makeScript('b')]
    const { allSelected, selectedIds } = useScriptSelection(() => scripts)
    selectedIds.value = new Set(['a', 'b'])
    expect(allSelected.value).toBe(true)
  })

  it('someSelected is true when a subset is selected', () => {
    const scripts = [makeScript('a'), makeScript('b')]
    const { someSelected, selectedIds } = useScriptSelection(() => scripts)
    selectedIds.value = new Set(['a'])
    expect(someSelected.value).toBe(true)
  })

  it('someSelected is false when all are selected', () => {
    const scripts = [makeScript('a'), makeScript('b')]
    const { someSelected, selectedIds } = useScriptSelection(() => scripts)
    selectedIds.value = new Set(['a', 'b'])
    expect(someSelected.value).toBe(false)
  })

  it('someSelected is false when none are selected', () => {
    const scripts = [makeScript('a'), makeScript('b')]
    const { someSelected } = useScriptSelection(() => scripts)
    expect(someSelected.value).toBe(false)
  })
})

// ─── toggleSelect – single click ─────────────────────────────────────────────

describe('toggleSelect – single click', () => {
  it('selects an unselected script', () => {
    const script = makeScript('a')
    const { toggleSelect, selectedIds } = useScriptSelection(() => [script])
    toggleSelect(script, makeEvent())
    expect(selectedIds.value.has('a')).toBe(true)
  })

  it('deselects an already-selected script', () => {
    const script = makeScript('a')
    const { toggleSelect, selectedIds } = useScriptSelection(() => [script])
    selectedIds.value = new Set(['a'])
    toggleSelect(script, makeEvent())
    expect(selectedIds.value.has('a')).toBe(false)
  })

  it('updates lastClickedId after a regular click', () => {
    const script = makeScript('a')
    const { toggleSelect, lastClickedId } = useScriptSelection(() => [script])
    toggleSelect(script, makeEvent())
    expect(lastClickedId.value).toBe('a')
  })
})

// ─── toggleSelect – shift+click range ────────────────────────────────────────

describe('toggleSelect – shift+click range select', () => {
  const scripts = ['a', 'b', 'c', 'd', 'e'].map(makeScript)

  it('selects a forward range', () => {
    const { toggleSelect, selectedIds } = useScriptSelection(() => scripts)
    toggleSelect(scripts[1]!, makeEvent())           // click 'b'
    toggleSelect(scripts[4]!, makeEvent({ shiftKey: true })) // shift+click 'e'
    expect([...selectedIds.value].sort()).toEqual(['b', 'c', 'd', 'e'])
  })

  it('selects a backward range', () => {
    const { toggleSelect, selectedIds } = useScriptSelection(() => scripts)
    toggleSelect(scripts[3]!, makeEvent())           // click 'd'
    toggleSelect(scripts[1]!, makeEvent({ shiftKey: true })) // shift+click 'b'
    expect([...selectedIds.value].sort()).toEqual(['b', 'c', 'd'])
  })

  it('merges range with existing selection', () => {
    const { toggleSelect, selectedIds } = useScriptSelection(() => scripts)
    selectedIds.value = new Set(['a'])
    toggleSelect(scripts[2]!, makeEvent())           // click 'c'
    toggleSelect(scripts[4]!, makeEvent({ shiftKey: true })) // shift+click 'e'
    expect(selectedIds.value.has('a')).toBe(true)   // existing kept
    expect(selectedIds.value.has('c')).toBe(true)
    expect(selectedIds.value.has('d')).toBe(true)
    expect(selectedIds.value.has('e')).toBe(true)
  })

  it('falls back to normal toggle when no prior click exists', () => {
    const { toggleSelect, selectedIds } = useScriptSelection(() => scripts)
    toggleSelect(scripts[2]!, makeEvent({ shiftKey: true }))
    expect(selectedIds.value.has('c')).toBe(true)
    expect(selectedIds.value.size).toBe(1)
  })

  it('calls preventDefault on shift+click', () => {
    const { toggleSelect } = useScriptSelection(() => scripts)
    const event = makeEvent({ shiftKey: true })
    const spy = vi.spyOn(event, 'preventDefault')
    toggleSelect(scripts[0]!, event)
    expect(spy).toHaveBeenCalledOnce()
  })

  it('does not call preventDefault on plain click', () => {
    const { toggleSelect } = useScriptSelection(() => scripts)
    const event = makeEvent()
    const spy = vi.spyOn(event, 'preventDefault')
    toggleSelect(scripts[0]!, event)
    expect(spy).not.toHaveBeenCalled()
  })
})

// ─── toggleSelectAll ──────────────────────────────────────────────────────────

describe('toggleSelectAll', () => {
  it('selects all scripts when none are selected', () => {
    const scripts = [makeScript('a'), makeScript('b'), makeScript('c')]
    const { toggleSelectAll, selectedIds } = useScriptSelection(() => scripts)
    toggleSelectAll()
    expect([...selectedIds.value].sort()).toEqual(['a', 'b', 'c'])
  })

  it('deselects all scripts when all are selected', () => {
    const scripts = [makeScript('a'), makeScript('b')]
    const { toggleSelectAll, selectedIds } = useScriptSelection(() => scripts)
    selectedIds.value = new Set(['a', 'b'])
    toggleSelectAll()
    expect(selectedIds.value.size).toBe(0)
  })

  it('resets lastClickedId when deselecting all', () => {
    const scripts = [makeScript('a'), makeScript('b')]
    const { toggleSelectAll, selectedIds, lastClickedId } = useScriptSelection(() => scripts)
    selectedIds.value = new Set(['a', 'b'])
    lastClickedId.value = 'b'
    toggleSelectAll()
    expect(lastClickedId.value).toBeNull()
  })

  it('selects all when only some are selected', () => {
    const scripts = [makeScript('a'), makeScript('b'), makeScript('c')]
    const { toggleSelectAll, selectedIds } = useScriptSelection(() => scripts)
    selectedIds.value = new Set(['a'])
    toggleSelectAll()
    expect([...selectedIds.value].sort()).toEqual(['a', 'b', 'c'])
  })
})

// ─── clearSelection ───────────────────────────────────────────────────────────

describe('clearSelection', () => {
  it('empties selectedIds', () => {
    const scripts = [makeScript('a'), makeScript('b')]
    const { clearSelection, selectedIds } = useScriptSelection(() => scripts)
    selectedIds.value = new Set(['a', 'b'])
    clearSelection()
    expect(selectedIds.value.size).toBe(0)
  })

  it('resets lastClickedId to null', () => {
    const scripts = [makeScript('a')]
    const { clearSelection, toggleSelect, lastClickedId } = useScriptSelection(() => scripts)
    toggleSelect(scripts[0]!, makeEvent())
    clearSelection()
    expect(lastClickedId.value).toBeNull()
  })
})
