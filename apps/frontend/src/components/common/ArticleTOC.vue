<template>
  <div class="article-toc" v-if="headings.length > 0">
    <div class="toc-title">{{ i18ns.t('article.toc') }}</div>
    <ul class="toc-list">
      <li
        v-for="heading in headings"
        :key="heading.id"
        :class="['toc-item', `toc-level-${heading.level}`]"
        :style="{ paddingLeft: (heading.level - minLevel) * 14 + 'px' }"
      >
        <a
          :href="`#${heading.id}`"
          :class="{ active: activeId === heading.id }"
          @click.prevent="scrollToHeading(heading.id)"
        >
          {{ heading.text }}
        </a>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'

interface TocHeading {
  id: string
  text: string
  level: number
}

const props = defineProps<{
  content: string
  activeId?: string
}>()

const emit = defineEmits<{
  (e: 'navigate', id: string): void
}>()

const headings = computed<TocHeading[]>(() => {
  if (!props.content) return []
  const regex = /^(#{1,4})\s+(.+)$/gm
  const result: TocHeading[] = []
  let match
  while ((match = regex.exec(props.content)) !== null) {
    const text = match[2]!.trim()
    const id = text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '')
    result.push({
      id,
      text,
      level: match[1]!.length,
    })
  }
  return result
})

const minLevel = computed(() => {
  if (headings.value.length === 0) return 1
  return Math.min(...headings.value.map((h) => h.level))
})

function scrollToHeading(id: string) {
  emit('navigate', id)
  const el = document.getElementById(id)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
</script>

<style scoped>
.article-toc {
  font-size: 13px;
  max-height: 320px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--el-border-color-dark) transparent;
}

.article-toc::-webkit-scrollbar {
  width: 3px;
}

.article-toc::-webkit-scrollbar-track {
  background: var(--el-fill-color-lighter);
  border-radius: 3px;
}

.article-toc::-webkit-scrollbar-thumb {
  background: var(--el-border-color-dark);
  border-radius: 3px;
}

.article-toc::-webkit-scrollbar-thumb:hover {
  background: var(--el-color-primary-light-3);
}

.toc-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.toc-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.toc-item {
  line-height: 1.6;
}

.toc-item a {
  display: block;
  padding: 3px 8px;
  color: var(--el-text-color-secondary);
  text-decoration: none;
  border-radius: 4px;
  transition: all 0.2s;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toc-item a:hover {
  color: var(--el-color-primary);
  background-color: var(--el-color-primary-light-9);
}

.toc-item a.active {
  color: var(--el-color-primary);
  font-weight: 500;
  background-color: var(--el-color-primary-light-9);
}
</style>
