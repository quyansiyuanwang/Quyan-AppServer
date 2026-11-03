<template>
  <nav class="page-contents" :aria-label="label">
    <a
      v-for="item in items"
      :key="item.id"
      :href="`#${item.id}`"
      :class="{ active: item.id === activeId, nested: item.level === 3 }"
      :aria-current="item.id === activeId ? 'location' : undefined"
      @click="$emit('navigate')"
      >{{ item.label }}</a
    >
  </nav>
</template>

<script setup lang="ts">
defineProps<{
  items: { id: string; label: string; level: 2 | 3 }[]
  activeId: string
  label: string
}>()
defineEmits<{ navigate: [] }>()
</script>

<style scoped>
.page-contents {
  display: grid;
  gap: 2px;
}
a {
  border-left: 2px solid var(--docs-border);
  padding: 9px 12px;
  color: var(--docs-muted);
  font-size: 13px;
  line-height: 1.5;
  text-decoration: none;
  overflow-wrap: anywhere;
}
a.nested {
  padding-left: 24px;
}
a:hover {
  color: var(--docs-primary-strong);
  background: var(--docs-primary-soft);
}
a.active {
  border-left-color: var(--docs-primary);
  color: var(--docs-primary-strong);
  background: var(--docs-primary-soft);
  font-weight: 600;
}
@media (pointer: coarse) {
  a {
    min-height: 44px;
  }
}
</style>
