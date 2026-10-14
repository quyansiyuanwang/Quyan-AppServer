<template>
  <section class="authorization-picker" :aria-label="title">
    <h4>{{ title }}</h4>
    <div class="picker-search">
      <el-input
        v-model="keyword"
        :disabled="disabled || records.loading.value"
        :placeholder="i18ns.t('RamManagement.authorizationSearch')"
        @keyup.enter="load(1)"
      />
      <el-button :disabled="disabled || records.loading.value" @click="load(1)">{{
        i18ns.t('RamManagement.authorizationSearchButton')
      }}</el-button>
    </div>
    <el-alert
      v-if="records.failed.value"
      :title="i18ns.t('RamManagement.scopedLoadFailed')"
      type="error"
      :closable="false"
    />
    <p v-else-if="!records.loading.value && !records.items.value.length">
      {{ i18ns.t('RamManagement.authorizationNoOptions') }}
    </p>
    <div v-loading="records.loading.value" class="picker-options">
      <div v-for="option in records.items.value" :key="option.id" class="picker-option">
        <el-checkbox
          :model-value="selectedIds.has(option.id)"
          :disabled="disabled || records.loading.value"
          :data-test="'pick-' + option.id"
          @change="toggle(option)"
          >{{ option.label }}</el-checkbox
        >
        <el-tag v-if="option.highRisk" type="danger" size="small">{{
          i18ns.t('RamManagement.authorizationHighRisk')
        }}</el-tag>
        <code>{{ option.id }}</code>
        <small v-if="option.description">{{ option.description }}</small>
      </div>
    </div>
    <RamIamPageControls
      :page="records.page.value"
      :page-size="records.pageSize.value"
      :has-next="records.hasNext.value"
      :loading="records.loading.value || disabled"
      @previous="load(records.page.value - 1)"
      @next="load(records.page.value + 1)"
      @size="resize"
    />
    <div class="picker-selected">
      <span>{{
        i18ns.t('RamManagement.authorizationSelected', { count: modelValue.length })
      }}</span>
      <el-tag
        v-for="option in modelValue"
        :key="option.id"
        :closable="!disabled"
        :type="option.highRisk ? 'danger' : 'info'"
        @close="toggle(option)"
        >{{ option.label }}</el-tag
      >
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { IamManagementPageResult } from '@quyan/shared'
import type {
  IamAuthorizationOption,
  IamAuthorizationOptionQuery,
} from '../iam-authorization-selection'
import { useIamManagementPage } from '../useIamManagementPage'
import { i18ns } from '@/locales'
import RamIamPageControls from './RamIamPageControls.vue'
const props = defineProps<{
  title: string
  modelValue: IamAuthorizationOption[]
  disabled: boolean
  multiple?: boolean
  fetchPage: (
    query: IamAuthorizationOptionQuery,
  ) => Promise<IamManagementPageResult<IamAuthorizationOption>>
}>()
const emit = defineEmits<{ 'update:modelValue': [items: IamAuthorizationOption[]] }>()
const keyword = ref('')
const records = useIamManagementPage((query) =>
  props.fetchPage({ ...query, ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}) }),
)
const selectedIds = computed(() => new Set(props.modelValue.map((option) => option.id)))
const toggle = (option: IamAuthorizationOption) => {
  if (props.disabled || records.loading.value) return
  emit(
    'update:modelValue',
    selectedIds.value.has(option.id)
      ? props.modelValue.filter((item) => item.id !== option.id)
      : props.multiple
        ? [...props.modelValue, option]
        : [option],
  )
}
const load = async (page = 1) => {
  if (props.disabled) return
  const loaded = await records.load(page)
  if (!loaded && records.failed.value) emit('update:modelValue', [])
  if (loaded) {
    const current = new Map(records.items.value.map((option) => [option.id, option]))
    const updated = props.modelValue.map((option) => current.get(option.id) ?? option)
    if (updated.some((option, index) => option !== props.modelValue[index]))
      emit('update:modelValue', updated)
  }
}
const resize = (size: number) => {
  records.pageSize.value = size
  void load(1)
}
watch(keyword, records.clear, { flush: 'sync' })
watch(
  () => props.fetchPage,
  () => {
    records.clear()
    keyword.value = ''
    emit('update:modelValue', [])
    void load(1)
  },
)
onMounted(() => void load(1))
onBeforeUnmount(records.clear)
</script>
<style scoped>
.authorization-picker {
  min-width: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 16px;
  display: grid;
  gap: 12px;
}
h4 {
  margin: 0;
}
.picker-search,
.picker-selected {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.picker-search .el-input {
  flex: 1;
  min-width: 140px;
}
.picker-options {
  display: grid;
  gap: 8px;
  min-height: 60px;
  max-height: 300px;
  overflow: auto;
}
.picker-option {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.picker-option small {
  flex-basis: 100%;
  color: var(--el-text-color-secondary);
}
code {
  overflow-wrap: anywhere;
  color: var(--el-text-color-secondary);
}
</style>
