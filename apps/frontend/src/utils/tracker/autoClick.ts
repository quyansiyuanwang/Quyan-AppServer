import { tracker } from './index'

// Tags and roles considered as interactive clickable elements
const CLICKABLE_TAGS = new Set([
  'BUTTON',
  'A',
  'SUMMARY',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'LABEL',
  'DETAILS',
])
const CLICKABLE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'tab',
  'option',
  'checkbox',
  'radio',
  'switch',
  'combobox',
  'searchbox',
  'slider',
  'spinbutton',
])

function getLabel(el: HTMLElement): string {
  const text =
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    el.textContent?.trim().slice(0, 50) ||
    el.className.split(' ').find((c) => c.length > 2 && !c.startsWith('el-')) ||
    el.tagName.toLowerCase()
  return text || 'unknown'
}

function findTrackTarget(target: EventTarget | null): {
  el: HTMLElement
  name: string
  props?: Record<string, unknown>
  explicit: boolean
} | null {
  let el = target as HTMLElement | null
  while (el && el !== document.body) {
    // Explicit data-track attribute takes priority
    const explicit = el.dataset['track']
    if (explicit) {
      let props: Record<string, unknown> | undefined
      const raw = el.dataset['trackProps']
      if (raw) {
        try {
          props = JSON.parse(raw) as Record<string, unknown>
        } catch {
          /* ignore */
        }
      }
      return { el, name: explicit, props, explicit: true }
    }
    // Auto-detect interactive elements
    const tag = el.tagName
    const role = el.getAttribute('role') ?? ''
    if (CLICKABLE_TAGS.has(tag) || CLICKABLE_ROLES.has(role)) {
      return { el, name: getLabel(el), props: { tagName: tag, role }, explicit: false }
    }
    el = el.parentElement
  }
  return null
}

export function setupAutoClickTrack() {
  document.addEventListener(
    'click',
    (e: MouseEvent) => {
      const result = findTrackTarget(e.target)
      if (!result) return
      tracker.track('click', result.name, result.props)
    },
    true,
  )
}
