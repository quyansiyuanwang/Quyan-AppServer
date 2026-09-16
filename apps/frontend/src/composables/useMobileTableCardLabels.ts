import { nextTick, onBeforeUnmount, onMounted } from 'vue'

interface MobileTableCardOptions {
  /** Observe the document so dynamically teleported drawers are included. */
  observeDocument?: boolean
}

export function useMobileTableCardLabels(
  rootSelector: string,
  options: MobileTableCardOptions = {},
) {
  let observer: MutationObserver | null = null
  let rafId = 0

  const applyLabels = () => {
    const roots = Array.from(document.querySelectorAll(rootSelector))
    if (!roots.length) return

    const tables = roots.flatMap((root) => Array.from(root.querySelectorAll('.el-table')))
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
    const observeTarget = options.observeDocument
      ? document.body
      : document.querySelector(rootSelector)
    if (!observeTarget) return

    observer = new MutationObserver(() => scheduleApply())
    observer.observe(observeTarget, {
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
