<template>
  <section class="search-results" aria-live="polite" :aria-label="text.title">
    <div class="search-results-heading">
      <strong>{{ matches.length }} {{ text.matches }}</strong>
      <button type="button" @click="$emit('clear')">{{ text.clear }}</button>
    </div>
    <p v-if="!matches.length" class="empty-result">{{ text.empty }}</p>
    <button
      v-for="page in matches"
      :key="page.slug"
      type="button"
      class="search-result"
      @click="$emit('select', page.slug)"
    >
      <strong>{{ page.title[locale] }}</strong>
      <span>{{ page.summary[locale] }}</span>
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DocsLocale, DocsPage } from '@/docs'
const props = defineProps<{ locale: DocsLocale; matches: DocsPage[] }>()
defineEmits<{ select: [slug: string]; clear: [] }>()
const text = computed(() =>
  props.locale === 'en'
    ? {
        title: 'Search results',
        matches: 'matches',
        clear: 'Clear',
        empty: 'No matching documents. Try another search term.',
      }
    : {
        title: '搜索结果',
        matches: '条匹配',
        clear: '清除',
        empty: '没有找到匹配的文档，请尝试其他关键词。',
      },
)
</script>

<style scoped>
.search-results {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.search-results-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}
.search-results-heading button {
  min-height: 44px;
  padding: 0 10px;
  background: transparent;
  color: var(--docs-primary-strong);
  border: 0;
  cursor: pointer;
}
.search-result {
  display: grid;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--docs-border);
  border-radius: 6px;
  background: var(--docs-surface);
  color: var(--docs-text);
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.search-result:hover {
  border-color: var(--docs-primary);
  background: var(--docs-primary-soft);
}
.search-result span,
.empty-result {
  font-size: 13px;
  line-height: 1.7;
  color: var(--docs-muted);
}
.search-result strong {
  font-size: 14px;
}
</style>
