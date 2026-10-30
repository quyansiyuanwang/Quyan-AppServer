<template>
  <nav class="docs-navigation" :aria-label="text.navigation">
    <div class="navigation-tools">
      <div class="navigation-title">{{ text.navigation }}</div>
      <div class="navigation-locales" :aria-label="text.language" role="group">
        <button
          v-for="option in localeOptions"
          :key="option.value"
          type="button"
          :aria-pressed="option.value === locale"
          @click="$emit('locale', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <label class="navigation-search">
        <span>{{ text.search }}</span>
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          :placeholder="text.placeholder"
          @keydown.enter.prevent="openFirstMatch"
        />
      </label>
    </div>
    <div class="navigation-pages">
      <DocsSearchResults
        v-if="compact && query.trim()"
        :locale="locale"
        :matches="matches"
        @select="$emit('select', $event)"
        @clear="query = ''"
      />
      <template v-else>
        <div v-for="group in groups" :key="group.label" class="navigation-group">
          <div class="navigation-group-title">{{ group.label }}</div>
          <button
            v-for="page in group.pages"
            :key="page.slug"
            type="button"
            class="navigation-page"
            :aria-current="page.slug === currentSlug ? 'page' : undefined"
            @click="$emit('select', page.slug)"
          >
            {{ page.title[locale] }}
          </button>
        </div>
      </template>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DocsLocale, DocsPage } from '@/docs'
import DocsSearchResults from './DocsSearchResults.vue'
const props = defineProps<{
  locale: DocsLocale
  currentSlug: string
  compact: boolean
  groups: { label: string; pages: DocsPage[] }[]
  matches: DocsPage[]
}>()
const emit = defineEmits<{ select: [slug: string]; locale: [locale: DocsLocale] }>()
const query = defineModel<string>('query', { required: true })
const searchInput = ref<HTMLInputElement | null>(null)
const localeOptions = [
  { value: 'zh-CN' as const, label: '中文' },
  { value: 'en' as const, label: 'English' },
]
const text = computed(() =>
  props.locale === 'en'
    ? {
        navigation: 'Documentation',
        search: 'Search docs',
        placeholder: 'Search title, tag, or content',
        language: 'Language',
      }
    : {
        navigation: '文档导航',
        search: '搜索文档',
        placeholder: '搜索标题、标签或正文',
        language: '语言',
      },
)
function openFirstMatch() {
  if (props.matches[0]) emit('select', props.matches[0].slug)
}
defineExpose({ focusSearch: () => searchInput.value?.focus() })
</script>

<style scoped>
.docs-navigation {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.navigation-tools {
  display: grid;
  flex: none;
  gap: 16px;
  padding: 20px 16px;
  border-bottom: 1px solid var(--docs-border);
}
.navigation-title {
  font-size: 15px;
  font-weight: 700;
}
.navigation-locales {
  display: flex;
  padding: 3px;
  background: var(--docs-surface-muted);
  border: 1px solid var(--docs-border);
  border-radius: 6px;
}
.navigation-locales button {
  flex: 1;
  min-height: 38px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--docs-muted);
  cursor: pointer;
  font-size: 13px;
}
.navigation-locales button[aria-pressed='true'] {
  background: var(--docs-surface);
  border-color: var(--docs-border);
  color: var(--docs-text-strong);
  box-shadow: var(--docs-shadow-soft);
}
.navigation-search {
  display: grid;
  gap: 8px;
  font-size: 12px;
  color: var(--docs-muted);
}
.navigation-search input {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--docs-border-strong);
  border-radius: 6px;
  background: var(--docs-surface);
  color: var(--docs-text);
  font-size: 16px;
}
.navigation-search input::placeholder {
  font-size: 13px;
  color: var(--docs-muted);
}
.navigation-pages {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 10px 24px;
  scrollbar-gutter: stable;
}
.navigation-group + .navigation-group {
  margin-top: 22px;
}
.navigation-group-title {
  padding: 0 12px 8px;
  color: var(--docs-muted);
  font-size: 12px;
  font-weight: 600;
}
.navigation-page {
  display: block;
  width: 100%;
  min-height: 44px;
  margin: 2px 0;
  padding: 10px 12px;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--docs-text);
  cursor: pointer;
  line-height: 1.5;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.navigation-page:hover {
  background: var(--docs-surface-muted);
}
.navigation-page[aria-current='page'] {
  background: var(--docs-primary-soft);
  color: var(--docs-primary-strong);
  border-color: var(--docs-border);
  font-weight: 600;
}
</style>
