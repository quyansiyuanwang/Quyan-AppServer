<template>
  <div :class="['markdown-body', `markdown-body--${props.variant}`]" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { renderArticleMarkdown } from '@/utils/asyncMarkdown'

const props = withDefaults(
  defineProps<{
    content: string
    variant?: 'article' | 'chat'
  }>(),
  { variant: 'article' },
)

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

/* Chat replies live in narrow message bubbles, so they need a denser reading rhythm. */
.markdown-body--chat {
  min-width: 0;
  font-size: 13px;
  line-height: 1.65;
}

.markdown-body--chat :deep(h1),
.markdown-body--chat :deep(h2),
.markdown-body--chat :deep(h3),
.markdown-body--chat :deep(h4) {
  margin: 12px 0 6px;
  padding: 0;
  border: 0;
  font-size: 14px;
  line-height: 1.45;
  font-weight: 650;
}

.markdown-body--chat :deep(h1:first-child),
.markdown-body--chat :deep(h2:first-child),
.markdown-body--chat :deep(h3:first-child),
.markdown-body--chat :deep(h4:first-child),
.markdown-body--chat :deep(p:first-child),
.markdown-body--chat :deep(ul:first-child),
.markdown-body--chat :deep(ol:first-child),
.markdown-body--chat :deep(pre:first-child),
.markdown-body--chat :deep(blockquote:first-child) {
  margin-top: 0;
}

.markdown-body--chat :deep(p) {
  margin: 0 0 8px;
}

.markdown-body--chat :deep(p:last-child),
.markdown-body--chat :deep(ul:last-child),
.markdown-body--chat :deep(ol:last-child),
.markdown-body--chat :deep(pre:last-child),
.markdown-body--chat :deep(blockquote:last-child),
.markdown-body--chat :deep(table:last-child) {
  margin-bottom: 0;
}

.markdown-body--chat :deep(a) {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-body--chat :deep(code) {
  padding: 1px 4px;
  overflow-wrap: anywhere;
}

.markdown-body--chat :deep(pre) {
  max-width: 100%;
  margin: 8px 0;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.markdown-body--chat :deep(blockquote) {
  margin: 8px 0;
  padding: 2px 10px;
  border-left-color: var(--el-color-primary-light-5);
}

.markdown-body--chat :deep(ul),
.markdown-body--chat :deep(ol) {
  margin: 4px 0 8px;
  padding-left: 1.4em;
}

.markdown-body--chat :deep(li) {
  margin: 2px 0;
}

.markdown-body--chat :deep(table) {
  display: block;
  width: max-content;
  min-width: 100%;
  max-width: 100%;
  margin: 8px 0;
  overflow-x: auto;
}

.markdown-body--chat :deep(th),
.markdown-body--chat :deep(td) {
  padding: 5px 8px;
}
</style>
