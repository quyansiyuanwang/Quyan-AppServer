<template>
  <div
    ref="docsPageRef"
    class="docs-page"
    :class="{
      'is-embedded': isEmbedded,
      'is-embedded-wide': isEmbeddedWide,
      'is-embedded-xl': isEmbeddedExtraWide,
      'is-wide': showSidebarPanel,
      'has-toc': showTocPanel,
    }"
  >
    <a class="skip-link" href="#docs-main">{{ ui.skipContent }}</a>
    <header ref="docsTopbarRef" class="docs-topbar" :class="{ 'is-embedded': isEmbedded }">
      <div class="brand-block">
        <div class="brand-mark">Q</div>
        <div>
          <div class="brand-name">QYSYW Docs</div>
          <div class="brand-note">{{ ui.brandNote }}</div>
        </div>
      </div>

      <div class="topbar-actions">
        <button
          v-if="!showSidebarPanel"
          ref="navigationTriggerRef"
          class="command-pill menu-trigger"
          type="button"
          :aria-label="ui.navigation"
          :aria-expanded="navigationOpen"
          aria-haspopup="dialog"
          @click="navigationOpen = true"
        >
          <span aria-hidden="true">☰</span>
        </button>
        <button class="command-pill search-trigger" type="button" @click="focusSearch">
          {{ ui.searchShort }}<kbd v-if="showSidebarPanel">Ctrl K</kbd>
        </button>
        <a class="top-link" :href="appBaseUrl" target="_blank" rel="noreferrer">{{
          ui.mainSite
        }}</a>
        <a class="top-link primary" :href="swaggerDocsUrl" target="_blank" rel="noreferrer">
          Swagger
        </a>
      </div>
    </header>

    <div class="docs-shell">
      <aside v-if="showSidebarPanel" class="sidebar-panel">
        <DocsNavigation
          ref="navigationRef"
          v-model:query="query"
          :locale="locale"
          :current-slug="currentSlug"
          :compact="false"
          :groups="groupedPages"
          :matches="searchMatches"
          @select="openPage"
          @locale="switchLocale"
        />
      </aside>
      <DocsDrawer v-else v-model="navigationOpen" :title="ui.navigation" :close-label="ui.close">
        <DocsNavigation
          ref="navigationRef"
          v-model:query="query"
          :locale="locale"
          :current-slug="currentSlug"
          :compact="true"
          :groups="groupedPages"
          :matches="searchMatches"
          @select="openPage"
          @locale="switchLocale"
        />
      </DocsDrawer>

      <main id="docs-main" class="content-panel" tabindex="-1">
        <section class="doc-hero" :class="{ 'is-embedded': isEmbedded }">
          <div class="doc-hero-main">
            <div v-if="showEmbeddedMeta" class="doc-breadcrumbs">
              <span>{{ currentPage.category[locale] }}</span>
              <span>/</span>
              <span>{{ currentPage.title[locale] }}</span>
            </div>

            <div v-if="showEmbeddedMeta" class="doc-meta-row">
              <span class="doc-update">{{ ui.updated }} {{ currentPage.updatedAt }}</span>
            </div>

            <h1>{{ currentPage.title[locale] }}</h1>
            <p class="doc-summary">{{ currentPage.summary[locale] }}</p>
          </div>

          <div v-if="showHeroSide" class="doc-hero-side">
            <div class="hero-side-card">
              <div class="hero-side-label">{{ ui.actions }}</div>
              <div class="doc-actions">
                <button class="action-button" type="button" @click="copyCurrentPageUrl">
                  {{ ui.copyPage }}
                </button>
                <a
                  class="action-button ghost"
                  :href="swaggerDocsUrl"
                  target="_blank"
                  rel="noreferrer"
                >
                  Swagger
                </a>
                <a class="action-button ghost" :href="appBaseUrl" target="_blank" rel="noreferrer">
                  App
                </a>
              </div>
            </div>
          </div>
        </section>

        <DocsSearchResults
          v-if="showSidebarPanel && query.trim()"
          class="result-panel"
          :locale="locale"
          :matches="searchMatches"
          @select="openPage"
          @clear="query = ''"
        />
        <details v-if="!showTocPanel && tocItems.length" ref="compactTocRef" class="compact-toc">
          <summary>{{ ui.toc }}<span aria-hidden="true">⌄</span></summary>
          <DocsTableOfContents
            :items="tocItems"
            :active-id="activeHeading"
            :label="ui.toc"
            @navigate="closeCompactToc"
          />
        </details>

        <section class="doc-layout">
          <article
            ref="articlePanelRef"
            class="article-panel"
            :class="{ 'is-embedded': isEmbedded }"
            v-html="renderedContent"
          ></article>

          <aside v-if="showTocPanel" class="toc-panel">
            <div class="toc-sticky">
              <div class="section-label">{{ ui.toc }}</div>
              <DocsTableOfContents :items="tocItems" :active-id="activeHeading" :label="ui.toc" />

              <div class="toc-card">
                <div class="toc-card-title">{{ ui.quickLinks }}</div>
                <a :href="appBaseUrl" target="_blank" rel="noreferrer">{{ appBaseUrlLabel }}</a>
                <a :href="swaggerDocsUrl" target="_blank" rel="noreferrer">{{
                  swaggerDocsUrlLabel
                }}</a>
              </div>
            </div>
          </aside>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import { useRoute, useRouter } from 'vue-router'
import { APP_BASE_URL, SWAGGER_DOCS_URL, interpolateDocsContent } from '@/config/site'
import { docsRegistry, type DocsLocale, type DocsSlug } from '@/docs'
import { glossaryRegistry, type GlossaryEntry } from '@/docs/glossary'
import { useCodeBlocks } from '@/composables/useCodeBlocks'
import { useActiveHeading } from '@/composables/useActiveHeading'
import DocsNavigation from '@/components/DocsNavigation.vue'
import DocsDrawer from '@/components/DocsDrawer.vue'
import DocsSearchResults from '@/components/DocsSearchResults.vue'
import DocsTableOfContents from '@/components/DocsTableOfContents.vue'

type TocItem = {
  id: string
  label: string
  level: 2 | 3
}

type GlossaryAliasMatch = {
  alias: string
  entryId: string
}

const route = useRoute()
const router = useRouter()
const query = ref('')
const navigationRef = ref<InstanceType<typeof DocsNavigation> | null>(null)
const navigationTriggerRef = ref<HTMLButtonElement | null>(null)
const navigationOpen = ref(false)
const compactTocRef = ref<HTMLDetailsElement | null>(null)
const topbarHeight = ref(0)
const articlePanelRef = ref<HTMLElement | null>(null)
const docsPageRef = ref<HTMLElement | null>(null)
const docsTopbarRef = ref<HTMLElement | null>(null)
const isEmbedded = computed(() => route.query.embed === '1')
const embeddedViewportWidth = ref<number>(0)
const appBaseUrl = APP_BASE_URL
const swaggerDocsUrl = SWAGGER_DOCS_URL

const EMBED_WIDE_BREAKPOINT = 1120
const EMBED_XL_BREAKPOINT = 1360

const isEmbeddedWide = computed(
  () => isEmbedded.value && embeddedViewportWidth.value >= EMBED_WIDE_BREAKPOINT,
)
const isEmbeddedExtraWide = computed(
  () => isEmbedded.value && embeddedViewportWidth.value >= EMBED_XL_BREAKPOINT,
)
const showSidebarPanel = computed(() => embeddedViewportWidth.value >= EMBED_WIDE_BREAKPOINT)
const showEmbeddedMeta = computed(() => !isEmbedded.value || isEmbeddedWide.value)
const showHeroSide = computed(() => !isEmbedded.value || isEmbeddedWide.value)
const showTocPanel = computed(() => embeddedViewportWidth.value >= EMBED_XL_BREAKPOINT)

let docsPageResizeObserver: ResizeObserver | null = null

const updateDocsLayout = () => {
  if (typeof window === 'undefined') {
    return
  }

  embeddedViewportWidth.value = window.innerWidth
  topbarHeight.value = docsTopbarRef.value?.offsetHeight ?? 0
  docsPageRef.value?.style.setProperty('--docs-topbar-height', `${topbarHeight.value}px`)
}

type MermaidModule = typeof import('mermaid')

let mermaidModulePromise: Promise<MermaidModule['default']> | null = null
let mermaidRenderSequence = 0

const getMermaid = async () => {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then((module) => {
      module.default.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'base',
        darkMode: false,
        themeVariables: {
          background: '#ffffff',
          primaryColor: '#eff6ff',
          primaryTextColor: '#0f172a',
          primaryBorderColor: '#3b82f6',
          secondaryColor: '#f8fafc',
          secondaryTextColor: '#0f172a',
          secondaryBorderColor: '#94a3b8',
          tertiaryColor: '#eef4ff',
          tertiaryTextColor: '#0f172a',
          tertiaryBorderColor: '#60a5fa',
          lineColor: '#334155',
          textColor: '#0f172a',
          mainBkg: '#eff6ff',
          secondBkg: '#f8fafc',
          tertiaryBkg: '#eef4ff',
          actorBkg: '#eff6ff',
          actorBorder: '#3b82f6',
          actorTextColor: '#0f172a',
          actorLineColor: '#64748b',
          signalColor: '#334155',
          signalTextColor: '#0f172a',
          labelBoxBkgColor: '#dbeafe',
          labelBoxBorderColor: '#60a5fa',
          labelTextColor: '#0f172a',
          loopTextColor: '#0f172a',
          noteBkgColor: '#fff7d6',
          noteBorderColor: '#f59e0b',
          noteTextColor: '#0f172a',
          activationBorderColor: '#64748b',
          activationBkgColor: '#e2e8f0',
          sequenceNumberColor: '#0f172a',
        },
      })

      return module.default
    })
  }

  return mermaidModulePromise
}

const toUrlLabel = (value: string) => {
  try {
    const url = new URL(value)
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return value
  }
}

const locale = computed<DocsLocale>(() =>
  docsRegistry.normalizeLocale(route.params.locale as string | undefined),
)
const currentSlug = computed<DocsSlug>(() => {
  const slug = route.params.slug as string | undefined
  return (docsRegistry.hasPage(slug) ? slug : docsRegistry.defaultSlug) as DocsSlug
})
const currentPage = computed(() => docsRegistry.getPage(currentSlug.value))
const appBaseUrlLabel = toUrlLabel(appBaseUrl)
const swaggerDocsUrlLabel = toUrlLabel(swaggerDocsUrl)

const ui = computed(() => ({
  close: locale.value === 'en' ? 'Close' : '关闭',
  searchShort: locale.value === 'en' ? 'Search' : '搜索',
  skipContent: locale.value === 'en' ? 'Skip to content' : '跳至正文',
  brandNote: locale.value === 'en' ? 'Product documentation' : '产品文档',
  mainSite: locale.value === 'en' ? 'Main site' : '进入应用',
  navigation: locale.value === 'en' ? 'Documentation' : '文档导航',
  updated: locale.value === 'en' ? 'Updated' : '更新于',
  actions: locale.value === 'en' ? 'Page actions' : '页面操作',
  clear: locale.value === 'en' ? 'Clear' : '清除',
  noResults:
    locale.value === 'en'
      ? 'No matching documents. Try another search term.'
      : '没有找到匹配的文档，请尝试其他关键词。',
  search: locale.value === 'en' ? 'Search docs' : '搜索文档',
  searchPlaceholder:
    locale.value === 'en' ? 'Search title, tag, or content' : '搜索标题、标签或正文',
  pages: locale.value === 'en' ? 'Pages' : '文档目录',
  searchResults: locale.value === 'en' ? 'Search results' : '搜索结果',
  matches: locale.value === 'en' ? 'matches' : '条匹配',
  toc: locale.value === 'en' ? 'On this page' : '本页目录',
  quickLinks: locale.value === 'en' ? 'Quick links' : '快捷链接',
  copyPage: locale.value === 'en' ? 'Copy page link' : '复制页面链接',
  glossary: locale.value === 'en' ? 'Glossary appendix' : '术语附录',
  glossaryLead:
    locale.value === 'en'
      ? 'The terms below explain technical words that appear on this page.'
      : '以下术语用于解释本页中出现的专业词汇。',
  jumpToGlossary: locale.value === 'en' ? 'Jump to glossary explanation' : '跳转到术语解释',
}))

const groupedPages = computed(() => docsRegistry.getGroupedPages(locale.value))

const normalizedQuery = computed(() => query.value.trim().toLowerCase())

const filteredPages = computed(() => {
  return docsRegistry.search(normalizedQuery.value, locale.value)
})

const searchMatches = computed(() => filteredPages.value)

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[&\/\\#,+()$~%.'":*?<>{}\[\]]/g, '')
    .trim()
    .replace(/\s+/g, '-')

const glossaryAnchorId = (entryId: string) => `glossary-${entryId}`
const asciiAliasPattern = /^[a-z0-9][a-z0-9 +./:-]*$/i

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const setHeadingAnchors = (html: string) => {
  const usedIds = new Set<string>()
  return html.replace(/<h([23])>(.*?)<\/h\1>/g, (_match, level, rawText) => {
    const text = String(rawText).replace(/<[^>]+>/g, '')
    const baseId = slugify(text)
    let id = baseId
    let suffix = 1
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`
    usedIds.add(id)
    return `<h${level} id="${id}">${rawText}</h${level}>`
  })
}

const buildGlossaryMatcher = (entries: GlossaryEntry[]) => {
  const aliases = entries
    .flatMap((entry) => entry.aliases.map((alias) => ({ alias, entryId: entry.id })))
    .sort((left, right) => right.alias.length - left.alias.length)

  const aliasMap = new Map<string, GlossaryAliasMatch>(
    aliases.map((item) => [item.alias.toLowerCase(), item]),
  )

  const pattern = aliases
    .map(({ alias }) => {
      const escapedAlias = escapeRegExp(alias)
      return asciiAliasPattern.test(alias) ? `\\b${escapedAlias}\\b` : escapedAlias
    })
    .join('|')

  return {
    aliasMap,
    regex: pattern ? new RegExp(pattern, 'gi') : null,
  }
}

const linkGlossaryTerms = (html: string, entries: GlossaryEntry[]) => {
  if (typeof window === 'undefined' || !entries.length) {
    return html
  }

  const { aliasMap, regex } = buildGlossaryMatcher(entries)
  if (!regex) {
    return html
  }

  const container = document.createElement('div')
  container.innerHTML = html

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentElement = node.parentElement
      if (!parentElement || !node.nodeValue?.trim()) {
        return NodeFilter.FILTER_REJECT
      }

      if (parentElement.closest('a, code, pre, h1, h2, h3, h4, h5, h6')) {
        return NodeFilter.FILTER_REJECT
      }

      return NodeFilter.FILTER_ACCEPT
    },
  })

  const textNodes: Text[] = []
  let currentNode = walker.nextNode()
  while (currentNode) {
    textNodes.push(currentNode as Text)
    currentNode = walker.nextNode()
  }

  for (const textNode of textNodes) {
    const sourceText = textNode.nodeValue ?? ''
    regex.lastIndex = 0

    if (!regex.test(sourceText)) {
      continue
    }

    regex.lastIndex = 0
    const fragment = document.createDocumentFragment()
    let lastIndex = 0

    for (const match of sourceText.matchAll(regex)) {
      const matchText = match[0]
      const index = match.index ?? 0
      const mappedAlias = aliasMap.get(matchText.toLowerCase())

      if (!mappedAlias) {
        continue
      }

      if (index > lastIndex) {
        fragment.append(sourceText.slice(lastIndex, index))
      }

      const link = document.createElement('a')
      link.href = `#${glossaryAnchorId(mappedAlias.entryId)}`
      link.className = 'glossary-term-link'
      link.title = ui.value.jumpToGlossary
      link.textContent = matchText
      fragment.append(link)

      lastIndex = index + matchText.length
    }

    if (lastIndex < sourceText.length) {
      fragment.append(sourceText.slice(lastIndex))
    }

    textNode.parentNode?.replaceChild(fragment, textNode)
  }

  return container.innerHTML
}

const renderMarkdownWithAnchors = (
  markdown: string,
  options?: {
    linkGlossaryTerms?: boolean
    glossaryEntries?: GlossaryEntry[]
  },
) => {
  const html = setHeadingAnchors(String(marked.parse(markdown)))

  if (!options?.linkGlossaryTerms || !options.glossaryEntries?.length) {
    return html
  }

  return linkGlossaryTerms(html, options.glossaryEntries)
}

const renderMermaidDiagrams = async () => {
  if (typeof window === 'undefined') return

  await nextTick()

  const container = articlePanelRef.value
  if (!container) return

  const nodes = Array.from(container.querySelectorAll<HTMLElement>('pre code.language-mermaid'))

  if (!nodes.length) {
    return
  }

  const mermaid = await getMermaid()

  for (const node of nodes) {
    const parentPre = node.closest('pre')
    if (!parentPre || parentPre.dataset.mermaidProcessed === 'true') {
      continue
    }

    const source = node.textContent?.trim()
    if (!source) continue

    const renderId = `docs-mermaid-${mermaidRenderSequence++}`

    try {
      const { svg } = await mermaid.render(renderId, source)
      const wrapper = document.createElement('div')
      wrapper.className = 'mermaid-diagram-block'
      wrapper.innerHTML = svg
      parentPre.replaceWith(wrapper)
    } catch (error) {
      console.error('Failed to render mermaid diagram', error)
      parentPre.dataset.mermaidProcessed = 'true'
    }
  }
}

const currentGlossaryEntries = computed(() => {
  const pageText = [
    currentPage.value.title[locale.value],
    currentPage.value.summary[locale.value],
    currentPage.value.tags.join(' '),
    currentPage.value.content[locale.value],
  ].join('\n')

  return [...glossaryRegistry.getEntriesForText(pageText)].sort((left, right) =>
    left.title[locale.value].localeCompare(right.title[locale.value]),
  )
})

const glossaryMarkdown = computed(() => {
  if (!currentGlossaryEntries.value.length) return ''

  const entries = currentGlossaryEntries.value
    .map(
      (entry) =>
        `<a id="${glossaryAnchorId(entry.id)}" class="glossary-anchor"></a>\n### ${entry.title[locale.value]}\n\n${entry.description[locale.value]}`,
    )
    .join('\n\n')

  return `\n\n## ${ui.value.glossary}\n\n${ui.value.glossaryLead}\n\n${entries}`
})

const pageMarkdown = computed(() =>
  interpolateDocsContent(`${currentPage.value.content[locale.value]}${glossaryMarkdown.value}`),
)

const renderedContent = computed(() => {
  const html = renderMarkdownWithAnchors(pageMarkdown.value, {
    linkGlossaryTerms: true,
    glossaryEntries: currentGlossaryEntries.value,
  })
  if (typeof window === 'undefined') return html

  // Resolve relative links against the canonical page path, even when the URL ends in a slash.
  const base = new URL(`/${locale.value}/${currentSlug.value}`, window.location.origin)
  const container = document.createElement('div')
  container.innerHTML = html
  for (const link of container.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = link.getAttribute('href')
    if (!href || href.startsWith('#') || link.hasAttribute('download') || link.target) continue
    if (!isEmbedded.value && !href.startsWith('./')) continue
    let destination: URL
    try {
      destination = new URL(href, base)
    } catch {
      continue
    }
    const match = /^\/(?:zh-CN|en)\/([^/]+)\/?$/.exec(destination.pathname)
    if (destination.origin !== base.origin || !match || !docsRegistry.hasPage(match[1])) continue
    if (isEmbedded.value) destination.searchParams.set('embed', '1')
    link.setAttribute('href', `${destination.pathname}${destination.search}${destination.hash}`)
  }
  return container.innerHTML
})

useCodeBlocks(articlePanelRef, renderedContent, locale)
const activeHeading = useActiveHeading(
  articlePanelRef,
  renderedContent,
  computed(() => (isEmbedded.value ? 0 : topbarHeight.value)),
)
const closeCompactToc = () => {
  if (compactTocRef.value) compactTocRef.value.open = false
}

const tocItems = computed<TocItem[]>(() => {
  if (typeof document === 'undefined') return []

  const container = document.createElement('div')
  container.innerHTML = renderedContent.value
  return Array.from(container.querySelectorAll<HTMLHeadingElement>('h2[id], h3[id]')).map(
    (heading) => ({
      id: heading.id,
      label: heading.textContent?.trim() ?? '',
      level: Number(heading.tagName.slice(1)) as 2 | 3,
    }),
  )
})

const openPage = async (slug: DocsSlug) => {
  query.value = ''
  navigationOpen.value = false
  closeCompactToc()
  await router.push({ name: 'docs', params: { locale: locale.value, slug }, query: route.query })
}

const switchLocale = async (nextLocale: DocsLocale) => {
  await router.push({
    name: 'docs',
    params: { locale: nextLocale, slug: currentSlug.value },
    query: route.query,
  })
}

const focusSearch = async () => {
  if (!showSidebarPanel.value) navigationOpen.value = true
  await nextTick()
  navigationRef.value?.focusSearch()
}

watch(showSidebarPanel, () => {
  navigationOpen.value = false
})
watch(
  () => route.fullPath,
  () => {
    navigationOpen.value = false
    closeCompactToc()
  },
)

const handleSearchShortcut = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    void focusSearch()
  }
}

const copyCurrentPageUrl = async () => {
  const url = new URL(`/${locale.value}/${currentPage.value.slug}`, window.location.origin)
  await navigator.clipboard.writeText(url.toString())
}

watch(
  () => route.params.slug,
  (slug) => {
    if (slug === undefined) {
      void router.replace({
        name: 'docs',
        params: { locale: locale.value, slug: docsRegistry.defaultSlug },
        query: route.query,
      })
    }
  },
  { immediate: true },
)

watch([renderedContent, locale], () => {
  void renderMermaidDiagrams()
})

onMounted(() => {
  updateDocsLayout()
  if (typeof ResizeObserver !== 'undefined' && docsPageRef.value) {
    docsPageResizeObserver = new ResizeObserver(() => {
      updateDocsLayout()
    })
    docsPageResizeObserver.observe(docsPageRef.value)
    if (docsTopbarRef.value) docsPageResizeObserver.observe(docsTopbarRef.value)
  }

  window.addEventListener('keydown', handleSearchShortcut)
  window.addEventListener('resize', updateDocsLayout)
  window.visualViewport?.addEventListener('resize', updateDocsLayout)
  void renderMermaidDiagrams()
})

onBeforeUnmount(() => {
  docsPageResizeObserver?.disconnect()
  docsPageResizeObserver = null
  window.removeEventListener('keydown', handleSearchShortcut)
  window.removeEventListener('resize', updateDocsLayout)
  window.visualViewport?.removeEventListener('resize', updateDocsLayout)
})
</script>

<style scoped>
.docs-page {
  --docs-anchor-offset: calc(var(--docs-topbar-height, 0px) + 32px);
  width: 100%;
  max-width: 1680px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 16px 24px 48px;
}
.docs-page.is-embedded {
  --docs-anchor-offset: 24px;
  min-height: auto;
  padding: 0;
}
.docs-page.is-embedded-wide {
  padding: 16px 24px 48px;
}
.skip-link {
  position: fixed;
  top: -100px;
  left: 24px;
  z-index: 100;
  padding: 12px 18px;
  background: var(--docs-surface);
  color: var(--docs-primary-strong);
  border: 2px solid var(--docs-primary);
  border-radius: 6px;
}
.skip-link:focus {
  top: 12px;
}
.docs-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
  padding: 12px 16px;
  border: 1px solid var(--docs-border);
  border-radius: 8px;
  background: var(--docs-surface);
  position: sticky;
  top: 12px;
  z-index: 20;
  box-shadow: var(--docs-shadow-soft);
}
.docs-topbar.is-embedded {
  position: static;
  margin-bottom: 0;
  border-radius: 0;
  border-width: 0 0 1px;
}
.brand-block {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.brand-mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  background: var(--docs-primary-soft);
  color: var(--docs-primary-strong);
  border: 1px solid var(--docs-border);
  border-radius: 8px;
  font-weight: 800;
}
.brand-name {
  font-size: 16px;
  font-weight: 700;
  white-space: nowrap;
}
.brand-note {
  margin-top: 2px;
  font-size: 11px;
  color: var(--docs-muted);
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.command-pill,
.top-link,
.action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--docs-border);
  border-radius: 6px;
  background: var(--docs-surface);
  color: var(--docs-text);
  text-decoration: none;
  font-size: 13px;
  cursor: pointer;
}
.command-pill:hover,
.top-link:hover,
.action-button:hover {
  border-color: var(--docs-primary);
  color: var(--docs-primary-strong);
  background: var(--docs-primary-soft);
}
.command-pill kbd {
  color: var(--docs-muted);
  font-size: 11px;
  padding: 2px 5px;
  border: 1px solid var(--docs-border);
  border-radius: 4px;
}
.menu-trigger {
  font-size: 18px;
  width: 44px;
  padding: 0;
}
.docs-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
}
.docs-page.is-wide .docs-shell {
  grid-template-columns: 252px minmax(0, 1fr);
}
.sidebar-panel {
  min-width: 0;
  position: sticky;
  top: calc(var(--docs-topbar-height) + 36px);
  align-self: start;
  height: calc(100dvh - var(--docs-topbar-height) - 56px);
  border: 1px solid var(--docs-border);
  border-radius: 8px;
  background: var(--docs-surface);
  overflow: hidden;
}
.docs-page.is-embedded .sidebar-panel {
  top: 20px;
  height: calc(100dvh - 40px);
}
.content-panel {
  min-width: 0;
  display: grid;
  gap: 16px;
  align-content: start;
}
.doc-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
  padding: 28px 32px;
  background: var(--docs-surface);
  border: 1px solid var(--docs-border);
  border-radius: 8px;
}
.doc-hero-main {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.doc-breadcrumbs,
.doc-meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--docs-muted);
}
.doc-hero h1 {
  margin: 4px 0 0;
  color: var(--docs-text-strong);
  font-size: clamp(24px, 2.3vw, 32px);
  line-height: 1.35;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}
.doc-summary {
  margin: 0;
  max-width: 75ch;
  color: var(--docs-muted);
  font-size: 15px;
  line-height: 1.8;
}
.hero-side-label {
  display: none;
}
.doc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.doc-actions .action-button {
  min-height: 36px;
  font-size: 12px;
}
.result-panel {
  padding: 20px;
  background: var(--docs-surface);
  border: 1px solid var(--docs-border);
  border-radius: 8px;
}
.doc-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.docs-page.has-toc .doc-layout {
  grid-template-columns: minmax(0, 1fr) 208px;
}
.article-panel {
  min-width: 0;
  padding: 28px 32px 40px;
  border: 1px solid var(--docs-border);
  border-radius: 8px;
  background: var(--docs-surface);
  overflow-wrap: anywhere;
  font-size: 15px;
}
.article-panel > :deep(:first-child + h2) {
  margin-top: 0;
}
.docs-page.is-embedded:not(.is-wide) .article-panel,
.docs-page.is-embedded:not(.is-wide) .doc-hero {
  border-radius: 0;
  border-width: 0 0 1px;
}
.toc-panel {
  position: sticky;
  top: calc(var(--docs-topbar-height) + 36px);
  min-width: 0;
  max-height: calc(100dvh - var(--docs-topbar-height) - 56px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 0;
}
.docs-page.is-embedded .toc-panel {
  top: 20px;
  max-height: calc(100dvh - 40px);
}
.section-label {
  margin-bottom: 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--docs-muted);
}
.toc-card {
  display: grid;
  gap: 10px;
  margin-top: 24px;
  padding: 20px 12px 0;
  border-top: 1px solid var(--docs-border);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.toc-card-title {
  color: var(--docs-muted);
}
.toc-card a {
  color: var(--docs-primary-strong);
  text-decoration: none;
  line-height: 1.6;
}
.compact-toc {
  padding: 0 16px;
  border: 1px solid var(--docs-border);
  border-radius: 6px;
  background: var(--docs-surface);
}
.compact-toc summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 48px;
  cursor: pointer;
  color: var(--docs-muted);
  font-size: 13px;
  list-style: none;
}
.compact-toc summary::-webkit-details-marker {
  display: none;
}
.compact-toc[open] {
  padding-bottom: 16px;
}
.compact-toc[open] summary span {
  transform: rotate(180deg);
}
.compact-toc :deep(.page-contents) {
  max-height: 45dvh;
  overflow-y: auto;
  overscroll-behavior: contain;
}
@media (max-width: 759px) {
  .docs-page {
    padding: 8px 12px 32px;
  }
  .docs-topbar {
    top: 0;
    margin-bottom: 12px;
    gap: 8px;
    padding: 8px;
  }
  .brand-mark {
    width: 30px;
    height: 30px;
  }
  .brand-name {
    font-size: 13px;
  }
  .brand-note,
  .topbar-actions .top-link {
    display: none;
  }
  .topbar-actions {
    gap: 4px;
  }
  .command-pill {
    padding: 0 10px;
  }
  .menu-trigger {
    padding: 0;
  }
  .content-panel {
    gap: 12px;
  }
  .doc-hero {
    padding: 22px 18px;
    gap: 16px;
  }
  .doc-hero h1 {
    font-size: 24px;
  }
  .doc-summary {
    font-size: 14px;
  }
  .article-panel {
    padding: 20px 18px 32px;
  }
  .doc-actions .action-button {
    min-height: 44px;
  }
  .article-panel :deep(.docs-jump-grid) {
    grid-template-columns: minmax(0, 1fr);
  }
}

:deep(.mermaid-diagram-block) {
  margin: 24px 0;
  padding: 16px;
  overflow-x: auto;
  border: 1px solid var(--docs-diagram-border);
  border-radius: 8px;
  background: var(--docs-diagram-bg);
  box-shadow: none;
}

:deep(.mermaid-diagram-block svg) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
  min-width: min(100%, 1080px);
}

:deep(.mermaid-diagram-block svg text) {
  fill: #0f172a !important;
}

:deep(.mermaid-diagram-block svg .label),
:deep(.mermaid-diagram-block svg .messageText),
:deep(.mermaid-diagram-block svg .loopText),
:deep(.mermaid-diagram-block svg .noteText),
:deep(.mermaid-diagram-block svg .actor),
:deep(.mermaid-diagram-block svg .actor > tspan) {
  fill: #0f172a !important;
  color: #0f172a !important;
  font-weight: 600;
}

:deep(.mermaid-diagram-block svg .note),
:deep(.mermaid-diagram-block svg .note rect),
:deep(.mermaid-diagram-block svg .labelBox),
:deep(.mermaid-diagram-block svg .actor-box),
:deep(.mermaid-diagram-block svg .actor-man),
:deep(.mermaid-diagram-block svg .node rect),
:deep(.mermaid-diagram-block svg .node polygon),
:deep(.mermaid-diagram-block svg .node circle) {
  filter: saturate(1.02) contrast(1.02);
}

:deep(.mermaid-diagram-block svg .actor),
:deep(.mermaid-diagram-block svg .actor-box),
:deep(.mermaid-diagram-block svg .labelBox),
:deep(.mermaid-diagram-block svg .label-container),
:deep(.mermaid-diagram-block svg .loopText),
:deep(.mermaid-diagram-block svg .loopText > tspan),
:deep(.mermaid-diagram-block svg .note),
:deep(.mermaid-diagram-block svg .note rect),
:deep(.mermaid-diagram-block svg .activation0),
:deep(.mermaid-diagram-block svg .activation1),
:deep(.mermaid-diagram-block svg .activation2) {
  fill: #eff6ff !important;
  stroke: #60a5fa !important;
}

:deep(.mermaid-diagram-block svg .note),
:deep(.mermaid-diagram-block svg .note rect) {
  fill: #fff7d6 !important;
  stroke: #f59e0b !important;
}

:deep(.mermaid-diagram-block svg .activation0),
:deep(.mermaid-diagram-block svg .activation1),
:deep(.mermaid-diagram-block svg .activation2) {
  fill: #dbeafe !important;
  stroke: #93c5fd !important;
}

:deep(.mermaid-diagram-block svg .messageLine0),
:deep(.mermaid-diagram-block svg .messageLine1),
:deep(.mermaid-diagram-block svg .actor-line),
:deep(.mermaid-diagram-block svg .loopLine),
:deep(.mermaid-diagram-block svg .loopText),
:deep(.mermaid-diagram-block svg path),
:deep(.mermaid-diagram-block svg line) {
  stroke-width: 1.6px;
}

.article-panel :deep(h1) {
  display: none;
}

.article-panel :deep(h2),
.article-panel :deep(h3) {
  margin-top: 1.6em;
  scroll-margin-top: var(--docs-anchor-offset);
}

.article-panel :deep(.glossary-anchor) {
  display: block;
  position: relative;
  top: calc(-1 * var(--docs-anchor-offset));
  visibility: hidden;
}

.article-panel :deep(.glossary-anchor:target + h3) {
  padding-left: 10px;
  border-left: 4px solid var(--docs-primary);
  background: var(--docs-primary-soft);
}

.article-panel :deep(h2) {
  font-size: 21px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--docs-border);
}

.article-panel :deep(h3) {
  font-size: 17px;
}

.article-panel :deep(p),
.article-panel :deep(li) {
  line-height: 1.8;
  color: var(--docs-text);
}

.article-panel :deep(.glossary-term-link) {
  color: var(--docs-primary-strong);
  font-weight: 700;
  text-decoration: underline dotted;
  text-underline-offset: 0.18em;
}

.article-panel :deep(.glossary-term-link:hover) {
  color: var(--docs-primary);
}

.article-panel :deep(p + p) {
  margin-top: 12px;
}

.article-panel :deep(.docs-jump-grid) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin: 18px 0 24px;
}

.article-panel :deep(.docs-jump-card) {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--docs-border);
  border-radius: 8px;
  background: var(--docs-surface-strong);
  color: inherit;
  text-decoration: none;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.article-panel :deep(.docs-jump-card:hover) {
  transform: none;
  border-color: var(--docs-border-strong);
}

.article-panel :deep(.docs-jump-card.current) {
  border-color: var(--docs-border-strong);
  background: var(--docs-surface-muted);
}

.article-panel :deep(.docs-jump-card strong) {
  font-size: 16px;
  color: var(--docs-text-strong);
}

.article-panel :deep(.docs-jump-card span) {
  line-height: 1.65;
  color: var(--docs-muted-soft);
}

.article-panel :deep(.docs-jump-card .docs-jump-eyebrow) {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--docs-primary-strong);
  font-weight: 800;
}

.article-panel :deep(ul),
.article-panel :deep(ol) {
  padding-left: 1.35rem;
}

.article-panel :deep(code) {
  padding: 0.18rem 0.42rem;
  border-radius: 6px;
  background: var(--docs-primary-soft);
  color: var(--docs-primary-strong);
}

.article-panel :deep(pre) {
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--docs-border);
  border-radius: 6px;
  background: var(--docs-code-bg);
  color: var(--docs-code-text);
}

.article-panel :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
}

.article-panel :deep(table) {
  display: block;
  width: 100%;
  max-width: 100%;
  border-collapse: collapse;
  overflow-x: auto;
  border-radius: 6px;
  background: var(--docs-table-bg);
}

.article-panel :deep(th),
.article-panel :deep(td) {
  padding: 12px 14px;
  border: 1px solid var(--docs-border);
  text-align: left;
}
</style>
