import { nextTick, onBeforeUnmount, onMounted } from 'vue'

export function useMobileTableCardLabels(rootSelector: string) {
  let observer: MutationObserver | null = null
  let rafId = 0

  const applyLabels = () => {
    const root = document.querySelector(rootSelector)
    if (!root) return

    const tables = root.querySelectorAll('.el-table')
    tables.forEach((table) => {
      const headers = Array.from(table.querySelectorAll('.el-table__header-wrapper th')).map(
        (th) => {
          const raw = th.querySelector('.cell')?.textContent || th.textContent || ''
          return raw.replace(/\s+/g, ' ').trim()
        },
      )

      const rows = table.querySelectorAll('.el-table__body-wrapper tbody tr')
      rows.forEach((row) => {
        const cells = Array.from(row.children)
        cells.forEach((cell, index) => {
          if (!(cell instanceof HTMLElement)) return
          const label = headers[index] || ''
          if (label) cell.setAttribute('data-label', label)
          else cell.removeAttribute('data-label')
        })
      })
    })
  }

  const scheduleApply = () => {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      rafId = 0
      applyLabels()
    })
  }

  onMounted(() => {
    nextTick(() => scheduleApply())
    const root = document.querySelector(rootSelector)
    if (!root) return

    observer = new MutationObserver(() => scheduleApply())
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    window.addEventListener('resize', scheduleApply)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    if (rafId) cancelAnimationFrame(rafId)
    window.removeEventListener('resize', scheduleApply)
  })
}
