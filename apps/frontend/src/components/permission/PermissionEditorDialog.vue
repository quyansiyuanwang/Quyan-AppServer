<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    :width="width"
    :close-on-click-modal="false"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
  >
    <PermissionEditorPanel
      v-model="selectedPermissions"
      :data="data"
      :hint="hint"
      :total-label="totalLabel"
      :search-placeholder="searchPlaceholder"
      :empty-text="emptyText"
      :filterable="filterable"
      :show-source="showSource"
      :loading="loading"
      :is-permission-disabled="isPermissionDisabled"
    >
      <template #header><slot name="header" /></template>
      <template #after-tree><slot name="after-tree" /></template>
    </PermissionEditorPanel>
    <template #footer>
      <slot name="footer">
        <el-button :disabled="saving" @click="emit('update:modelValue', false)">{{
          cancelText
        }}</el-button>
        <el-button type="primary" :loading="saving" :disabled="saveDisabled" @click="emit('save')">
          {{ saveText }}
        </el-button>
      </slot>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import PermissionEditorPanel from './PermissionEditorPanel.vue'
import type { PermissionTreeNode } from '@/views/management/permission-tree'

interface Props {
  modelValue: boolean
  title: string
  data: PermissionTreeNode[]
  permissions: string[]
  hint?: string
  totalLabel?: string
  searchPlaceholder?: string
  emptyText?: string
  width?: string
  filterable?: boolean
  showSource?: boolean
  loading?: boolean
  saving?: boolean
  saveDisabled?: boolean
  cancelText?: string
  saveText?: string
  isPermissionDisabled?: (permission: string) => boolean
}

const props = withDefaults(defineProps<Props>(), {
  hint: '',
  totalLabel: '',
  searchPlaceholder: '',
  emptyText: '',
  width: 'min(760px, 96vw)',
  filterable: true,
  showSource: false,
  loading: false,
  saving: false,
  saveDisabled: false,
  cancelText: 'Cancel',
  saveText: 'Save',
  isPermissionDisabled: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:permissions': [value: string[]]
  save: []
  closed: []
}>()

const selectedPermissions = computed({
  get: () => props.permissions,
  set: (value: string[]) => emit('update:permissions', value),
})
</script>
