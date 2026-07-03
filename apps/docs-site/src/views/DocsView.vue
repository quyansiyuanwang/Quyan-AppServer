<template>
  <div
    ref="docsPageRef"
    class="docs-page"
    :class="{
      'is-embedded': isEmbedded,
      'is-embedded-wide': isEmbeddedWide,
      'is-embedded-xl': isEmbeddedExtraWide,
    }"
  >
    <header class="docs-topbar" :class="{ 'is-embedded': isEmbedded }">
      <div class="brand-block">
        <div class="brand-mark">Q</div>
        <div>
          <div class="brand-name">QYSYW Docs</div>
          <div class="brand-note">Structured product manual · 双语文档</div>
        </div>
      </div>

      <div class="topbar-actions">
        <button class="command-pill" type="button" @click="focusSearch">
          Ctrl + K
        </button>
        <a class="top-link" :href="appBaseUrl" target="_blank" rel="noreferrer"
          >Main site</a
        >
        <a
          class="top-link primary"
          :href="swaggerDocsUrl"
          target="_blank"
          rel="noreferrer"
        >
          Swagger
        </a>
      </div>
    </header>

    <div class="docs-shell">
      <aside v-if="showSidebarPanel" class="sidebar-panel">
        <div class="sidebar-section sidebar-toolbar">
          <div class="sidebar-headline">
            <div class="sidebar-eyebrow">Documentation hub</div>
            <h2>Search, skim, jump</h2>
            <p>
              Reference-first navigation with denser structure and clearer
              hierarchy.
            </p>
          </div>

          <div class="locale-switch">
            <button
              v-for="option in localeOptions"
              :key="option.value"
              class="locale-button"
              :class="{ active: option.value === locale }"
              @click="switchLocale(option.value)"
            >
              {{ option.label }}
            </button>
          </div>

          <label class="search-box">
            <span class="search-label">{{ ui.search }}</span>
            <input
              ref="searchInputRef"
              v-model="query"
              :placeholder="ui.searchPlaceholder"
              @keydown.enter.prevent="openFirstMatch"
            />
          </label>

          <div class="sidebar-stats">
            <div class="stat-chip">
              <span class="stat-label">{{ ui.pages }}</span>
              <strong>{{ docsRegistry.pages.length }}</strong>
            </div>
            <div class="stat-chip">
              <span class="stat-label">{{ ui.toc }}</span>
              <strong>{{ tocItems.length }}</strong>
            </div>
          </div>
        </div>

        <div class="sidebar-section sidebar-groups">
          <div class="sidebar-groups-head">
            <div class="section-label">{{ ui.pages }}</div>
            <div class="sidebar-groups-meta">
              {{ groupedPages.length }} groups
            </div>
          </div>

          <div
            v-for="group in groupedPages"
            :key="group.label"
            class="group-block"
          >
            <div class="group-title">{{ group.label }}</div>
            <button
              v-for="page in group.pages"
              :key="page.slug"
              class="page-item"
              :class="{ active: page.slug === currentPage.slug }"
              @click="openPage(page.slug)"
            >
              <div class="page-item-title">{{ page.title[locale] }}</div>
              <div class="page-item-summary">{{ page.summary[locale] }}</div>
            </button>
          </div>
        </div>
      </aside>

      <main class="content-panel">
        <section class="doc-hero" :class="{ 'is-embedded': isEmbedded }">
          <div class="doc-hero-main">
            <div v-if="showEmbeddedMeta" class="doc-breadcrumbs">
              <span>{{ currentPage.category[locale] }}</span>
              <span>/</span>
              <span>{{ currentPage.slug }}</span>
            </div>

            <div class="doc-meta-row">
              <span v-if="showEmbeddedMeta" class="doc-method">DOC</span>
              <span class="doc-route">{{ docsRouteLabel }}</span>
              <span v-if="showEmbeddedMeta" class="doc-update"
                >Updated {{ currentPage.updatedAt }}</span
              >
            </div>

            <h1>{{ currentPage.title[locale] }}</h1>
            <p class="doc-summary">{{ currentPage.summary[locale] }}</p>

            <div v-if="showEmbeddedMeta" class="doc-tags">
              <span v-for="tag in currentPage.tags" :key="tag" class="doc-tag"
                >#{{ tag }}</span
              >
            </div>
          </div>

          <div v-if="showHeroSide" class="doc-hero-side">
            <div class="hero-side-card">
              <div class="hero-side-label">Route</div>
              <div class="hero-side-value">{{ currentPage.slug }}</div>
            </div>
            <div class="hero-side-card">
              <div class="hero-side-label">Actions</div>
              <div class="doc-actions">
                <button
                  class="action-button"
                  type="button"
                  @click="copyCurrentPageUrl"
                >
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
                <a
                  class="action-button ghost"
                  :href="appBaseUrl"
                  target="_blank"
                  rel="noreferrer"
                >
                  App
                </a>
              </div>
            </div>
          </div>
        </section>

        <section
          v-if="query.trim() && searchMatches.length"
          class="result-panel"
        >
          <div class="panel-header">
            <div>
              <div class="section-label">{{ ui.searchResults }}</div>
              <h3>{{ searchMatches.length }} {{ ui.matches }}</h3>
            </div>
            <button
              class="action-button ghost"
              type="button"
              @click="query = ''"
            >
              Clear
            </button>
          </div>

          <div class="result-list">
            <button
              v-for="page in searchMatches"
              :key="page.slug"
              class="result-card"
              @click="openPage(page.slug)"
            >
              <div class="result-title">{{ page.title[locale] }}</div>
              <div class="result-desc">{{ page.summary[locale] }}</div>
              <div class="result-tags">
                <span v-for="tag in page.tags" :key="tag">#{{ tag }}</span>
              </div>
            </button>
          </div>
        </section>

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
              <a
                v-for="item in tocItems"
                :key="item.id"
                class="toc-link"
                :href="`#${item.id}`"
              >
                <span class="toc-bullet" :class="`level-${item.level}`"></span>
                <span>{{ item.label }}</span>
              </a>

              <div class="toc-card">
                <div class="toc-card-title">{{ ui.quickLinks }}</div>
                <a :href="appBaseUrl" target="_blank" rel="noreferrer">{{
                  appBaseUrlLabel
                }}</a>
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
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { marked } from "marked";
import { useRoute, useRouter } from "vue-router";
import {
  APP_BASE_URL,
  DOCS_BASE_URL,
  SWAGGER_DOCS_URL,
  interpolateDocsContent,
} from "@/config/site";
import { docsRegistry, type DocsLocale, type DocsSlug } from "@/docs";
import { glossaryRegistry, type GlossaryEntry } from "@/docs/glossary";

type TocItem = {
  id: string;
  label: string;
  level: 2 | 3;
};

type GlossaryAliasMatch = {
  alias: string;
  entryId: string;
};

const route = useRoute();
const router = useRouter();
const query = ref("");
const searchInputRef = ref<HTMLInputElement | null>(null);
const articlePanelRef = ref<HTMLElement | null>(null);
const docsPageRef = ref<HTMLElement | null>(null);
const isEmbedded = computed(() => route.query.embed === "1");
const embeddedViewportWidth = ref<number>(0);
const appBaseUrl = APP_BASE_URL;
const swaggerDocsUrl = SWAGGER_DOCS_URL;

const EMBED_WIDE_BREAKPOINT = 1120;
const EMBED_XL_BREAKPOINT = 1360;

const isEmbeddedWide = computed(
  () =>
    isEmbedded.value && embeddedViewportWidth.value >= EMBED_WIDE_BREAKPOINT,
);
const isEmbeddedExtraWide = computed(
  () => isEmbedded.value && embeddedViewportWidth.value >= EMBED_XL_BREAKPOINT,
);
const showSidebarPanel = computed(
  () => !isEmbedded.value || isEmbeddedWide.value,
);
const showEmbeddedMeta = computed(
  () => !isEmbedded.value || isEmbeddedWide.value,
);
const showHeroSide = computed(() => !isEmbedded.value || isEmbeddedWide.value);
const showTocPanel = computed(
  () => !isEmbedded.value || isEmbeddedExtraWide.value,
);

let docsPageResizeObserver: ResizeObserver | null = null;

const updateEmbeddedViewportWidth = () => {
  if (typeof window === "undefined") {
    return;
  }

  embeddedViewportWidth.value =
    docsPageRef.value?.clientWidth ||
    document.documentElement?.clientWidth ||
    window.visualViewport?.width ||
    window.innerWidth;
};

type MermaidModule = typeof import("mermaid");

let mermaidModulePromise: Promise<MermaidModule["default"]> | null = null;
let mermaidRenderSequence = 0;

const getMermaid = async () => {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid").then((module) => {
      module.default.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        theme: "base",
        darkMode: false,
        themeVariables: {
          background: "#ffffff",
          primaryColor: "#eff6ff",
          primaryTextColor: "#0f172a",
          primaryBorderColor: "#3b82f6",
          secondaryColor: "#f8fafc",
          secondaryTextColor: "#0f172a",
          secondaryBorderColor: "#94a3b8",
          tertiaryColor: "#eef4ff",
          tertiaryTextColor: "#0f172a",
          tertiaryBorderColor: "#60a5fa",
          lineColor: "#334155",
          textColor: "#0f172a",
          mainBkg: "#eff6ff",
          secondBkg: "#f8fafc",
          tertiaryBkg: "#eef4ff",
          actorBkg: "#eff6ff",
          actorBorder: "#3b82f6",
          actorTextColor: "#0f172a",
          actorLineColor: "#64748b",
          signalColor: "#334155",
          signalTextColor: "#0f172a",
          labelBoxBkgColor: "#dbeafe",
          labelBoxBorderColor: "#60a5fa",
          labelTextColor: "#0f172a",
          loopTextColor: "#0f172a",
          noteBkgColor: "#fff7d6",
          noteBorderColor: "#f59e0b",
          noteTextColor: "#0f172a",
          activationBorderColor: "#64748b",
          activationBkgColor: "#e2e8f0",
          sequenceNumberColor: "#0f172a",
        },
      });

      return module.default;
    });
  }

  return mermaidModulePromise;
};

const toUrlLabel = (value: string) => {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value;
  }
};

const locale = computed<DocsLocale>(() =>
  docsRegistry.normalizeLocale(route.params.locale as string | undefined),
);
const currentSlug = computed<DocsSlug>(() => {
  const slug = route.params.slug as string | undefined;
  return (
    docsRegistry.hasPage(slug) ? slug : docsRegistry.defaultSlug
  ) as DocsSlug;
});
const currentPage = computed(() => docsRegistry.getPage(currentSlug.value));
const docsRouteLabel = computed(
  () =>
    `${toUrlLabel(DOCS_BASE_URL)}/${locale.value}/${currentPage.value.slug}`,
);
const appBaseUrlLabel = toUrlLabel(appBaseUrl);
const swaggerDocsUrlLabel = toUrlLabel(swaggerDocsUrl);

const localeOptions = [
  { value: "zh-CN" as const, label: "中文" },
  { value: "en" as const, label: "EN" },
];

const ui = computed(() => ({
  search: locale.value === "en" ? "Search docs" : "搜索文档",
  searchPlaceholder:
    locale.value === "en"
      ? "Search title, tag, or content"
      : "搜索标题、标签或正文",
  pages: locale.value === "en" ? "Pages" : "文档目录",
  searchResults: locale.value === "en" ? "Search results" : "搜索结果",
  matches: locale.value === "en" ? "matches" : "条匹配",
  toc: locale.value === "en" ? "On this page" : "本页目录",
  quickLinks: locale.value === "en" ? "Quick links" : "快捷链接",
  copyPage: locale.value === "en" ? "Copy page link" : "复制页面链接",
  glossary: locale.value === "en" ? "Glossary appendix" : "术语附录",
  glossaryLead:
    locale.value === "en"
      ? "The terms below explain technical words that appear on this page."
      : "以下术语用于解释本页中出现的专业词汇。",
  jumpToGlossary:
    locale.value === "en" ? "Jump to glossary explanation" : "跳转到术语解释",
}));

const groupedPages = computed(() => docsRegistry.getGroupedPages(locale.value));

const normalizedQuery = computed(() => query.value.trim().toLowerCase());

const filteredPages = computed(() => {
  return docsRegistry.search(normalizedQuery.value, locale.value);
});

const searchMatches = computed(() => filteredPages.value);

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[&\/\\#,+()$~%.'":*?<>{}\[\]]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const glossaryAnchorId = (entryId: string) => `glossary-${entryId}`;
const asciiAliasPattern = /^[a-z0-9][a-z0-9 +./:-]*$/i;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const setHeadingAnchors = (html: string) => {
  return html.replace(/<h([23])>(.*?)<\/h\1>/g, (_match, level, rawText) => {
    const text = String(rawText).replace(/<[^>]+>/g, "");
    const id = slugify(text);
    return `<h${level} id="${id}">${rawText}</h${level}>`;
  });
};

const buildGlossaryMatcher = (entries: GlossaryEntry[]) => {
  const aliases = entries
    .flatMap((entry) =>
      entry.aliases.map((alias) => ({ alias, entryId: entry.id })),
    )
    .sort((left, right) => right.alias.length - left.alias.length);

  const aliasMap = new Map<string, GlossaryAliasMatch>(
    aliases.map((item) => [item.alias.toLowerCase(), item]),
  );

  const pattern = aliases
    .map(({ alias }) => {
      const escapedAlias = escapeRegExp(alias);
      return asciiAliasPattern.test(alias)
        ? `\\b${escapedAlias}\\b`
        : escapedAlias;
    })
    .join("|");

  return {
    aliasMap,
    regex: pattern ? new RegExp(pattern, "gi") : null,
  };
};

const linkGlossaryTerms = (html: string, entries: GlossaryEntry[]) => {
  if (typeof window === "undefined" || !entries.length) {
    return html;
  }

  const { aliasMap, regex } = buildGlossaryMatcher(entries);
  if (!regex) {
    return html;
  }

  const container = document.createElement("div");
  container.innerHTML = html;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentElement = node.parentElement;
      if (!parentElement || !node.nodeValue?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      if (parentElement.closest("a, code, pre, h1, h2, h3, h4, h5, h6")) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode as Text);
    currentNode = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const sourceText = textNode.nodeValue ?? "";
    regex.lastIndex = 0;

    if (!regex.test(sourceText)) {
      continue;
    }

    regex.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;

    for (const match of sourceText.matchAll(regex)) {
      const matchText = match[0];
      const index = match.index ?? 0;
      const mappedAlias = aliasMap.get(matchText.toLowerCase());

      if (!mappedAlias) {
        continue;
      }

      if (index > lastIndex) {
        fragment.append(sourceText.slice(lastIndex, index));
      }

      const link = document.createElement("a");
      link.href = `#${glossaryAnchorId(mappedAlias.entryId)}`;
      link.className = "glossary-term-link";
      link.title = ui.value.jumpToGlossary;
      link.textContent = matchText;
      fragment.append(link);

      lastIndex = index + matchText.length;
    }

    if (lastIndex < sourceText.length) {
      fragment.append(sourceText.slice(lastIndex));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return container.innerHTML;
};

const renderMarkdownWithAnchors = (
  markdown: string,
  options?: {
    linkGlossaryTerms?: boolean;
    glossaryEntries?: GlossaryEntry[];
  },
) => {
  const html = setHeadingAnchors(String(marked.parse(markdown)));

  if (!options?.linkGlossaryTerms || !options.glossaryEntries?.length) {
    return html;
  }

  return linkGlossaryTerms(html, options.glossaryEntries);
};

const renderMermaidDiagrams = async () => {
  if (typeof window === "undefined") return;

  await nextTick();

  const container = articlePanelRef.value;
  if (!container) return;

  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>("pre code.language-mermaid"),
  );

  if (!nodes.length) {
    return;
  }

  const mermaid = await getMermaid();

  for (const node of nodes) {
    const parentPre = node.closest("pre");
    if (!parentPre || parentPre.dataset.mermaidProcessed === "true") {
      continue;
    }

    const source = node.textContent?.trim();
    if (!source) continue;

    const renderId = `docs-mermaid-${mermaidRenderSequence++}`;

    try {
      const { svg } = await mermaid.render(renderId, source);
      const wrapper = document.createElement("div");
      wrapper.className = "mermaid-diagram-block";
      wrapper.innerHTML = svg;
      parentPre.replaceWith(wrapper);
    } catch (error) {
      console.error("Failed to render mermaid diagram", error);
      parentPre.dataset.mermaidProcessed = "true";
    }
  }
};

const currentGlossaryEntries = computed(() => {
  const pageText = [
    currentPage.value.title[locale.value],
    currentPage.value.summary[locale.value],
    currentPage.value.tags.join(" "),
    currentPage.value.content[locale.value],
  ].join("\n");

  return [...glossaryRegistry.getEntriesForText(pageText)].sort((left, right) =>
    left.title[locale.value].localeCompare(right.title[locale.value]),
  );
});

const glossaryMarkdown = computed(() => {
  if (!currentGlossaryEntries.value.length) return "";

  const entries = currentGlossaryEntries.value
    .map(
      (entry) =>
        `<a id="${glossaryAnchorId(entry.id)}" class="glossary-anchor"></a>\n### ${entry.title[locale.value]}\n\n${entry.description[locale.value]}`,
    )
    .join("\n\n");

  return `\n\n## ${ui.value.glossary}\n\n${ui.value.glossaryLead}\n\n${entries}`;
});

const pageMarkdown = computed(() =>
  interpolateDocsContent(
    `${currentPage.value.content[locale.value]}${glossaryMarkdown.value}`,
  ),
);

const renderedContent = computed(() =>
  renderMarkdownWithAnchors(pageMarkdown.value, {
    linkGlossaryTerms: true,
    glossaryEntries: currentGlossaryEntries.value,
  }),
);

const tocItems = computed<TocItem[]>(() => {
  const content = pageMarkdown.value;
  const items: TocItem[] = [];

  for (const line of content.split("\n")) {
    const headingMatch = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    if (!headingMatch) continue;

    const level = headingMatch[1]!.length as 2 | 3;
    const label = headingMatch[2]!.replace(/[`*_>]/g, "").trim();
    items.push({ id: slugify(label), label, level });
  }

  return items;
});

const openPage = async (slug: DocsSlug) => {
  await router.push({ name: "docs", params: { locale: locale.value, slug } });
};

const switchLocale = async (nextLocale: DocsLocale) => {
  await router.push({
    name: "docs",
    params: { locale: nextLocale, slug: currentSlug.value },
  });
};

const focusSearch = async () => {
  await nextTick();
  searchInputRef.value?.focus();
};

const openFirstMatch = async () => {
  const first = searchMatches.value[0];
  if (first) await openPage(first.slug);
};

const copyCurrentPageUrl = async () => {
  const url = new URL(
    `/${locale.value}/${currentPage.value.slug}`,
    window.location.origin,
  );
  await navigator.clipboard.writeText(url.toString());
};

watch(
  () => route.params.slug,
  (slug) => {
    if (slug === undefined) {
      void router.replace({
        name: "docs",
        params: { locale: locale.value, slug: docsRegistry.defaultSlug },
      });
    }
  },
  { immediate: true },
);

watch([renderedContent, locale], () => {
  void renderMermaidDiagrams();
});

onMounted(() => {
  updateEmbeddedViewportWidth();
  if (typeof ResizeObserver !== "undefined" && docsPageRef.value) {
    docsPageResizeObserver = new ResizeObserver(() => {
      updateEmbeddedViewportWidth();
    });
    docsPageResizeObserver.observe(docsPageRef.value);
  }

  window.addEventListener("resize", updateEmbeddedViewportWidth);
  window.visualViewport?.addEventListener(
    "resize",
    updateEmbeddedViewportWidth,
  );
  void renderMermaidDiagrams();
});

onBeforeUnmount(() => {
  docsPageResizeObserver?.disconnect();
  docsPageResizeObserver = null;
  window.removeEventListener("resize", updateEmbeddedViewportWidth);
  window.visualViewport?.removeEventListener(
    "resize",
    updateEmbeddedViewportWidth,
  );
});
</script>

<style scoped>
.docs-page {
  min-height: 100vh;
  max-width: var(--docs-max-width);
  margin: 0 auto;
  padding: 16px 20px 24px;
  width: 100%;
}

.docs-page.is-embedded {
  min-height: auto;
  padding: 0;
}

.docs-page.is-embedded-wide {
  padding: 16px 20px 24px;
}

.docs-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 14px 18px;
  border: 1px solid var(--docs-topbar-border);
  border-radius: 8px;
  background: var(--docs-topbar-start);
  color: var(--docs-topbar-text);
  box-shadow: var(--docs-shadow);
  position: sticky;
  top: 12px;
  z-index: 20;
}

.docs-topbar.is-embedded {
  position: static;
  top: auto;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 0;
  border-left: 0;
  border-right: 0;
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 14px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: var(--docs-surface-muted);
  color: var(--docs-text-strong);
  font-weight: 700;
}

.brand-name {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.brand-note {
  margin-top: 2px;
  color: var(--docs-topbar-muted);
  font-size: 12px;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.command-pill,
.top-link,
.action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid var(--docs-topbar-pill-border);
  background: var(--docs-topbar-pill);
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.command-pill:hover,
.top-link:hover,
.action-button:hover {
  border-color: var(--docs-border-strong);
}

.top-link.primary,
.action-button {
  background: var(--docs-surface-strong);
  color: var(--docs-text);
  border-color: var(--docs-border);
  box-shadow: none;
}

.docs-shell {
  display: grid;
  grid-template-columns: 308px minmax(0, 1fr);
  gap: 14px;
  width: 100%;
}

.sidebar-panel,
.content-panel {
  min-width: 0;
}

.sidebar-panel {
  display: grid;
  gap: 12px;
  align-self: start;
  position: sticky;
  top: 68px;
}

.sidebar-section,
.doc-hero,
.result-panel,
.article-panel,
.toc-panel {
  border: 1px solid var(--docs-border);
  border-radius: 8px;
  background: var(--docs-surface);
  box-shadow: var(--docs-shadow);
}

.sidebar-eyebrow,
.section-label,
.doc-breadcrumbs,
.doc-meta-row,
.toc-card-title,
.search-label {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--docs-muted);
  font-weight: 700;
}

.sidebar-headline {
  display: grid;
  gap: 4px;
}

.sidebar-headline h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.1;
}

.sidebar-headline p {
  margin: 0;
  color: var(--docs-muted);
  line-height: 1.6;
  font-size: 13px;
}

.sidebar-toolbar,
.sidebar-groups,
.result-panel,
.article-panel,
.toc-panel {
  padding: 14px;
}

.sidebar-toolbar {
  padding: 6px 14px 14px;
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

.sidebar-groups {
  max-height: calc(100vh - 208px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.sidebar-toolbar {
  display: grid;
  gap: 8px;
}

.sidebar-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.stat-chip {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--docs-border);
  border-radius: 8px;
  background: var(--docs-surface-strong);
}

.stat-chip strong {
  font-size: 18px;
  color: var(--docs-text-strong);
}

.stat-label {
  color: var(--docs-muted-soft);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.sidebar-groups-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sidebar-groups-meta {
  color: var(--docs-muted-soft);
  font-size: 12px;
}

.locale-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.locale-button,
.page-item,
.result-card,
.toc-link {
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
}

.locale-button {
  min-height: 36px;
  border-color: var(--docs-border);
  border-radius: 6px;
  background: var(--docs-surface-strong);
  color: var(--docs-muted);
  transition:
    border-color 0.18s ease,
    color 0.18s ease,
    background-color 0.18s ease;
}

.locale-button.active {
  background: var(--docs-surface-muted);
  color: var(--docs-text);
  border-color: var(--docs-border-strong);
}

.search-box {
  display: grid;
  gap: 6px;
}

.search-box input {
  width: 100%;
  min-height: 42px;
  padding: 0 14px;
  border: 1px solid var(--docs-border);
  border-radius: 6px;
  background: var(--docs-surface-soft);
  color: var(--docs-text);
}

.search-box input:focus {
  border-color: rgba(37, 99, 235, 0.3);
  background: var(--docs-surface-strong);
}

.group-block {
  display: grid;
  gap: 6px;
  margin-top: 12px;
}

.group-title {
  color: var(--docs-muted-soft);
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.page-item {
  display: grid;
  gap: 4px;
  text-align: left;
  padding: 12px;
  border-radius: 6px;
  border-color: var(--docs-border);
  background: var(--docs-surface-strong);
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.page-item:hover,
.page-item.active {
  border-color: var(--docs-border-strong);
  background: var(--docs-surface-muted);
}

.page-item.active {
  position: relative;
}

.page-item.active::before {
  content: "";
  position: absolute;
  inset: 8px auto 8px 0;
  width: 2px;
  border-radius: 0 999px 999px 0;
  background: var(--docs-primary);
}

.page-item-title {
  font-weight: 800;
  color: var(--docs-text-strong);
}

.page-item-summary,
.doc-summary,
.result-desc {
  color: var(--docs-muted-soft);
  line-height: 1.6;
  font-size: 13px;
}

.content-panel {
  display: grid;
  gap: 12px;
  align-content: start;
}

.doc-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 14px;
  background: var(--docs-hero-start);
  color: var(--docs-hero-text);
  overflow: hidden;
  padding: 16px 18px;
}

.doc-hero.is-embedded {
  grid-template-columns: 1fr;
  padding: 14px 16px;
  border-radius: 0;
  border-left: 0;
  border-right: 0;
}

.docs-page.is-embedded-wide .doc-hero.is-embedded {
  grid-template-columns: minmax(0, 1fr) 240px;
  padding: 16px 18px;
  border-radius: 8px;
  border-left: 1px solid var(--docs-border);
  border-right: 1px solid var(--docs-border);
}

.doc-hero-main,
.doc-hero-side {
  min-width: 0;
}

.doc-hero-main {
  display: grid;
  gap: 10px;
}

.doc-hero-side {
  display: grid;
  gap: 10px;
  align-content: start;
}

.hero-side-card {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--docs-hero-border);
  border-radius: 6px;
  background: var(--docs-surface-strong);
}

.hero-side-label {
  color: var(--docs-muted-soft);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hero-side-value {
  color: var(--docs-text-strong);
  font-size: 14px;
  font-weight: 700;
  word-break: break-word;
}

.doc-breadcrumbs,
.doc-meta-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.doc-meta-row {
  margin-top: 0;
}

.doc-method,
.doc-route,
.doc-update {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 9px;
  border-radius: 6px;
  background: var(--docs-surface-strong);
  color: var(--docs-hero-text);
  border: 1px solid var(--docs-hero-border);
  font-size: 11px;
}

.doc-method {
  background: var(--docs-surface-muted);
  color: var(--docs-text);
  font-weight: 700;
}

.doc-hero h1 {
  margin: 0;
  font-size: clamp(22px, 2.3vw, 30px);
  line-height: 1.18;
  letter-spacing: -0.02em;
}

.doc-summary {
  margin: 0;
  max-width: 70ch;
  font-size: 14px;
  line-height: 1.65;
  color: var(--docs-hero-muted);
}

.doc-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 0;
}

.doc-tag {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: var(--docs-surface-strong);
  color: var(--docs-hero-text);
  font-size: 11px;
}

.doc-actions {
  display: grid;
  gap: 8px;
}

.action-button.ghost {
  background: var(--docs-surface-strong);
  border-color: var(--docs-border);
  color: inherit;
  box-shadow: none;
}

.result-panel {
  display: grid;
  gap: 12px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.panel-header h3 {
  margin: 6px 0 0;
  font-size: 20px;
}

.result-list {
  display: grid;
  gap: 8px;
}

.result-card {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 6px;
  text-align: left;
  background: var(--docs-surface-strong);
  border-color: var(--docs-border);
  transition:
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}

.result-card:hover {
  border-color: var(--docs-border-strong);
}

.result-title {
  font-weight: 800;
}

.result-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--docs-primary);
  font-size: 12px;
}

.doc-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 14px;
  align-items: start;
}

.article-panel {
  padding: 24px 28px;
}

.article-panel.is-embedded {
  padding: 20px 18px 28px;
  border-radius: 0;
  border-left: 0;
  border-right: 0;
}

.docs-page.is-embedded-wide .article-panel.is-embedded {
  padding: 24px 28px;
  border-radius: 8px;
  border-left: 1px solid var(--docs-border);
  border-right: 1px solid var(--docs-border);
}

.docs-page.is-embedded-wide .docs-shell {
  grid-template-columns: 308px minmax(0, 1fr);
}

.docs-page.is-embedded-xl .doc-layout {
  grid-template-columns: minmax(0, 1fr) 280px;
}

.article-panel :deep(h1) {
  display: none;
}

.article-panel :deep(h2),
.article-panel :deep(h3) {
  margin-top: 1.6em;
  scroll-margin-top: 24px;
}

.article-panel :deep(.glossary-anchor) {
  display: block;
  position: relative;
  top: -24px;
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
  width: 100%;
  border-collapse: collapse;
  overflow: hidden;
  border-radius: 6px;
  background: var(--docs-table-bg);
}

.article-panel :deep(th),
.article-panel :deep(td) {
  padding: 12px 14px;
  border: 1px solid var(--docs-border);
  text-align: left;
}

.toc-panel {
  position: sticky;
  top: 84px;
}

.toc-sticky {
  display: grid;
  gap: 8px;
}

.toc-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 6px;
  text-align: left;
  color: var(--docs-text);
  text-decoration: none;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.toc-link:hover {
  background: var(--docs-surface-muted);
  color: var(--docs-text);
}

.toc-bullet {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--docs-primary);
}

.toc-bullet.level-3 {
  width: 6px;
  height: 6px;
  opacity: 0.75;
}

.toc-card {
  display: grid;
  gap: 8px;
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--docs-border);
}

.toc-card a {
  color: var(--docs-primary);
  text-decoration: none;
}

.toc-card a:hover {
  color: var(--docs-primary-strong);
}

@media (max-width: 1120px) {
  .docs-page.is-embedded-wide .doc-hero,
  .docs-page.is-embedded-wide .docs-shell,
  .docs-page.is-embedded-xl .doc-layout {
    grid-template-columns: 1fr;
  }

  .doc-hero,
  .docs-shell,
  .doc-layout {
    grid-template-columns: 1fr;
  }

  .sidebar-panel,
  .toc-panel {
    position: relative;
    top: 0;
  }

  .sidebar-groups {
    max-height: none;
    overflow: visible;
  }

  .doc-actions {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .docs-page {
    padding: 12px;
  }

  .docs-topbar {
    flex-direction: column;
    align-items: stretch;
  }

  .topbar-actions {
    justify-content: flex-start;
  }

  .article-panel,
  .doc-hero,
  .result-panel,
  .toc-panel,
  .sidebar-section {
    border-radius: 12px;
  }

  .docs-page.is-embedded .content-panel {
    gap: 0;
  }

  .docs-page.is-embedded .doc-layout {
    grid-template-columns: 1fr;
  }

  .article-panel {
    padding: 20px 16px;
  }

  :deep(.mermaid-diagram-block) {
    padding: 14px;
    border-radius: 12px;
  }

  :deep(.mermaid-diagram-block svg) {
    min-width: 760px;
  }

  .doc-actions {
    grid-template-columns: 1fr;
  }

  .sidebar-stats {
    grid-template-columns: 1fr;
  }
}
</style>
