<template>
  <div class="markdown-body" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { renderArticleMarkdown } from '@/utils/asyncMarkdown'

const props = defineProps<{
  content: string
}>()

const renderedHtml = ref('')
let renderVersion = 0

watch(
  () => props.content,
  async (content) => {
    const currentRenderVersion = ++renderVersion
    const html = await renderArticleMarkdown(content)
    if (currentRenderVersion !== renderVersion) return
    renderedHtml.value = html
  },
  { immediate: true },
)
</script>

<style scoped>
.markdown-body {
  font-size: 15px;
  line-height: 1.75;
  color: var(--el-text-color-primary);
  word-wrap: break-word;
}

.markdown-body :deep(h1) {
  font-size: 2em;
  margin: 0.67em 0;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.markdown-body :deep(h2) {
  font-size: 1.5em;
  margin: 0.83em 0;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.markdown-body :deep(h3) {
  font-size: 1.25em;
  margin: 1em 0;
}

.markdown-body :deep(h4) {
  font-size: 1em;
  margin: 1.33em 0;
}

.markdown-body :deep(p) {
  margin: 0.8em 0;
}

.markdown-body :deep(a) {
  color: var(--el-color-primary);
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(code) {
  padding: 0.2em 0.4em;
  margin: 0;
  font-size: 85%;
  background-color: var(--el-fill-color-light);
  border-radius: 4px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

.markdown-body :deep(pre) {
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background-color: var(--el-fill-color-light);
  border-radius: 6px;
  margin: 1em 0;
}

.markdown-body :deep(pre code) {
  padding: 0;
  margin: 0;
  font-size: 100%;
  background-color: transparent;
  border-radius: 0;
}

.markdown-body :deep(blockquote) {
  margin: 1em 0;
  padding: 0 1em;
  color: var(--el-text-color-secondary);
  border-left: 4px solid var(--el-border-color);
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 2em;
  margin: 0.5em 0;
}

.markdown-body :deep(li) {
  margin: 0.25em 0;
}

.markdown-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 8px 13px;
  border: 1px solid var(--el-border-color);
}

.markdown-body :deep(th) {
  background-color: var(--el-fill-color-light);
  font-weight: 600;
}

.markdown-body :deep(tr:nth-child(2n)) {
  background-color: var(--el-fill-color-lighter);
}

.markdown-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

.markdown-body :deep(hr) {
  height: 2px;
  margin: 24px 0;
  background-color: var(--el-border-color-lighter);
  border: none;
}
</style>
