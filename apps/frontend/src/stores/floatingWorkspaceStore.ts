import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import localStorageKeys from '@/constant/storagekey'
import { i18ns } from '@/locales'
import { normalizeDocsLocale, resolveDocsUrl } from '@/config/docs'
import { resolveCurrentSiteProfile } from '@/config/site-registry'

export type FloatingWorkspaceTabType = 'docs' | 'swagger' | 'internal' | 'support'

export type FloatingWorkspaceTab = {
  id: string
  type: FloatingWorkspaceTabType
  title: string
  src: string
  closable: boolean
  pageKey?: string
}

type FloatingWorkspaceState = {
  visible: boolean
  activeTabId: string | null
  tabs: FloatingWorkspaceTab[]
  rect: {
    width: number
    height: number
    right: number
    bottom: number
  }
}

const DEFAULT_RECT = {
  width: 960,
  height: 680,
  right: 24,
  bottom: 88,
}

const FLOATING_WORKSPACE_MAX_VIEWPORT_RATIO = 0.8
const FLOATING_WORKSPACE_STORAGE_KEY = `${localStorageKeys.Overlay.FLOATING_WORKSPACE_STATE}:${resolveCurrentSiteProfile().id}`

const getViewportLimits = () => {
  if (typeof window === 'undefined') {
    return {
      maxWidth: 1400,
      maxHeight: 960,
    }
  }

  return {
    maxWidth: Math.max(0, Math.floor(window.innerWidth * FLOATING_WORKSPACE_MAX_VIEWPORT_RATIO)),
    maxHeight: Math.max(0, Math.floor(window.innerHeight * FLOATING_WORKSPACE_MAX_VIEWPORT_RATIO)),
  }
}

const clampRect = (rect: FloatingWorkspaceState['rect']): FloatingWorkspaceState['rect'] => {
  const { maxWidth, maxHeight } = getViewportLimits()

  return {
    width: clampNumber(rect.width, 0, maxWidth),
    height: clampNumber(rect.height, 0, maxHeight),
    right: Math.max(12, rect.right),
    bottom: Math.max(12, rect.bottom),
  }
}

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const createDefaultState = (): FloatingWorkspaceState => ({
  visible: false,
  activeTabId: null,
  tabs: [],
  rect: { ...DEFAULT_RECT },
})

const createTabId = () => `workspace-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const cloneTab = (tab: FloatingWorkspaceTab): FloatingWorkspaceTab => ({ ...tab })

const isSupportedTabType = (type: unknown): type is FloatingWorkspaceTabType =>
  type === 'docs' || type === 'swagger' || type === 'internal' || type === 'support'

const normalizeState = (input: unknown): FloatingWorkspaceState => {
  const fallback = createDefaultState()
  if (!input || typeof input !== 'object') return fallback

  const value = input as Partial<FloatingWorkspaceState>
  const tabs = Array.isArray(value.tabs)
    ? value.tabs
        .filter(
          (tab): tab is FloatingWorkspaceTab =>
            Boolean(tab) &&
            typeof tab === 'object' &&
            typeof (tab as FloatingWorkspaceTab).id === 'string' &&
            isSupportedTabType((tab as FloatingWorkspaceTab).type) &&
            typeof (tab as FloatingWorkspaceTab).title === 'string' &&
            typeof (tab as FloatingWorkspaceTab).src === 'string',
        )
        .map(cloneTab)
    : []

  const activeTabId =
    typeof value.activeTabId === 'string' && tabs.some((tab) => tab.id === value.activeTabId)
      ? value.activeTabId
      : (tabs[0]?.id ?? null)

  return {
    visible: Boolean(value.visible),
    activeTabId,
    tabs,
    rect: clampRect({
      width:
        typeof value.rect?.width === 'number' && Number.isFinite(value.rect.width)
          ? value.rect.width
          : DEFAULT_RECT.width,
      height:
        typeof value.rect?.height === 'number' && Number.isFinite(value.rect.height)
          ? value.rect.height
          : DEFAULT_RECT.height,
      right:
        typeof value.rect?.right === 'number' && Number.isFinite(value.rect.right)
          ? value.rect.right
          : DEFAULT_RECT.right,
      bottom:
        typeof value.rect?.bottom === 'number' && Number.isFinite(value.rect.bottom)
          ? value.rect.bottom
          : DEFAULT_RECT.bottom,
    }),
  }
}

const loadState = (): FloatingWorkspaceState => {
  if (typeof window === 'undefined') {
    return createDefaultState()
  }

  try {
    const rawValue = TypedLocalStorage.getItem(FLOATING_WORKSPACE_STORAGE_KEY)
    if (!rawValue) {
      return createDefaultState()
    }

    return normalizeState(JSON.parse(rawValue))
  } catch {
    return createDefaultState()
  }
}

export const useFloatingWorkspaceStore = defineStore('floatingWorkspace', () => {
  const state = ref<FloatingWorkspaceState>(loadState())

  const persist = () => {
    if (typeof window === 'undefined') {
      return
    }

    TypedLocalStorage.setItem(FLOATING_WORKSPACE_STORAGE_KEY, JSON.stringify(state.value))
  }

  const activeTab = computed(
    () => state.value.tabs.find((tab) => tab.id === state.value.activeTabId) ?? null,
  )

  const ensureVisible = () => {
    state.value.visible = true
  }

  const setActiveTab = (tabId: string) => {
    if (!state.value.tabs.some((tab) => tab.id === tabId)) return
    state.value.activeTabId = tabId
    ensureVisible()
    persist()
  }

  const upsertTab = (nextTab: Omit<FloatingWorkspaceTab, 'id'> & { id?: string }) => {
    const existingTab = state.value.tabs.find((tab) => {
      if (nextTab.type !== tab.type) return false
      if (nextTab.type === 'docs' || nextTab.type === 'swagger') {
        return true
      }
      return nextTab.pageKey && nextTab.pageKey === tab.pageKey
    })

    if (existingTab) {
      existingTab.title = nextTab.title
      existingTab.src = nextTab.src
      existingTab.closable = nextTab.closable
      existingTab.pageKey = nextTab.pageKey
      state.value.activeTabId = existingTab.id
      ensureVisible()
      persist()
      return existingTab
    }

    const tab: FloatingWorkspaceTab = {
      id: nextTab.id ?? createTabId(),
      type: nextTab.type,
      title: nextTab.title,
      src: nextTab.src,
      closable: nextTab.closable,
      pageKey: nextTab.pageKey,
    }

    state.value.tabs = [...state.value.tabs, tab]
    state.value.activeTabId = tab.id
    ensureVisible()
    persist()
    return tab
  }

  const openDocs = (routeName?: string | null) => {
    const locale = normalizeDocsLocale(i18ns.refer.value)
    const baseUrl = resolveDocsUrl(routeName, locale)
    const url = new URL(baseUrl)
    url.searchParams.set('embed', '1')

    return upsertTab({
      type: 'docs',
      title: i18ns.t('nav.docs'),
      src: url.toString(),
      closable: true,
    })
  }

  const openSwagger = (src: string) => {
    const url = new URL(src, window.location.origin)
    url.searchParams.set('embed', '1')

    return upsertTab({
      type: 'swagger',
      title: i18ns.t('workspace.swaggerTitle'),
      src: url.toString(),
      closable: true,
    })
  }

  const openSupport = () =>
    upsertTab({
      type: 'support',
      pageKey: 'support',
      title: i18ns.t('nav.helpCenter'),
      src: '',
      closable: true,
    })

  const openInternalPage = (pageKey: string, title: string, routePath: string) => {
    const url = new URL(routePath, window.location.origin)
    url.searchParams.set('embed', '1')

    return upsertTab({
      type: 'internal',
      pageKey,
      title,
      src: url.toString(),
      closable: true,
    })
  }

  const closeTab = (tabId: string) => {
    const tabs = state.value.tabs
    const index = tabs.findIndex((tab) => tab.id === tabId)
    if (index < 0) return

    const nextTabs = tabs.filter((tab) => tab.id !== tabId)
    state.value.tabs = nextTabs

    if (state.value.activeTabId === tabId) {
      state.value.activeTabId =
        nextTabs[index]?.id ?? nextTabs[index - 1]?.id ?? nextTabs[0]?.id ?? null
    }

    if (!nextTabs.length) {
      state.value.visible = false
    }

    persist()
  }

  const show = () => {
    ensureVisible()
    persist()
  }

  const hide = () => {
    state.value.visible = false
    persist()
  }

  const restore = () => {
    ensureVisible()
    persist()
  }

  const updateRect = (partial: Partial<FloatingWorkspaceState['rect']>) => {
    state.value.rect = clampRect({
      ...state.value.rect,
      ...partial,
    })
    persist()
  }

  return {
    state,
    activeTab,
    setActiveTab,
    openDocs,
    openSwagger,
    openSupport,
    openInternalPage,
    closeTab,
    show,
    hide,
    restore,
    updateRect,
  }
})
