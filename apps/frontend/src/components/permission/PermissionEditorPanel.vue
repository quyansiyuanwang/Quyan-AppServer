<template>
  <div class="permission-editor-panel" :class="{ 'is-loading': loading }">
    <el-alert
      v-if="hint"
      :title="hint"
      type="info"
      :closable="false"
      show-icon
      class="permission-editor-hint"
    />
    <slot name="header" />
    <div v-if="showSummary" class="permission-editor-summary" aria-live="polite">
      <strong>{{ modelValue.length }}</strong>
      <span class="permission-editor-summary-separator">/</span>
      <span>{{ dataLeafCount }} {{ totalLabel }}</span>
    </div>
    <PermissionTreeSelector
      v-model="selectedPermissions"
      :data="data"
      :is-permission-disabled="isPermissionDisabled"
      :search-placeholder="searchPlaceholder"
      :empty-text="emptyText"
      :filterable="filterable"
      :show-source="showSource"
    />
    <slot name="after-tree" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import PermissionTreeSelector from './PermissionTreeSelector.vue'
import type { PermissionTreeNode } from '@/views/management/permission-tree'

interface Props {
  modelValue: string[]
  data: PermissionTreeNode[]
  hint?: string
  totalLabel?: string
  searchPlaceholder?: string
  emptyText?: string
  filterable?: boolean
  showSource?: boolean
  loading?: boolean
  isPermissionDisabled?: (permission: string) => boolean
  showSummary?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  hint: '',
  totalLabel: '',
  searchPlaceholder: '',
  emptyText: '',
  filterable: true,
  showSource: false,
  loading: false,
  isPermissionDisabled: undefined,
  showSummary: true,
})

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()
const selectedPermissions = computed({
  get: () => props.modelValue,
  set: (value: string[]) => emit('update:modelValue', value),
})
const dataLeafCount = computed(() => {
  const count = (nodes: PermissionTreeNode[]): number =>
    nodes.reduce((total, node) => total + (node.children?.length ? count(node.children) : 1), 0)
  return count(props.data)
})
</script>

<style scoped lang="scss">
.permission-editor-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;

  &.is-loading {
    opacity: 0.72;
    pointer-events: none;
  }
}

.permission-editor-hint {
  margin: 0;
}

.permission-editor-summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);

  strong {
    color: var(--el-color-primary);
    font-size: 24px;
    line-height: 1;
  }

  .permission-editor-summary-separator {
    color: var(--el-text-color-placeholder);
  }
}

:deep(.permission-tree-selector) {
  min-height: 280px;
}

@media (max-width: 640px) {
  .permission-editor-summary {
    padding: 10px 12px;
  }
}
</style>
