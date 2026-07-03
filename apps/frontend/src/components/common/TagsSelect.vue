<template>
  <el-select
    multiple
    clearable
    popper-class="custom-header"
    :model-value="modelValue"
    @update:modelValue="updateValue"
    style="width: 100%"
  >
    <template #header>
      <el-checkbox :model-value="checkAll" :indeterminate="indeterminate" @change="handleCheckAll">
        {{ i18ns.t('all') }}
      </el-checkbox>
    </template>
    <el-option v-for="lang in allTags" :key="lang" :label="lang" :value="lang" />
  </el-select>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { computed } from 'vue'
import type { PropType } from 'vue'

const props = defineProps({
  modelValue: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
  allTags: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
  itemTitle: {
    type: String,
    default: 'Tags',
  },
})
const emit = defineEmits(['update:modelValue'])

const checkAll = computed({
  get: () => props.modelValue.length === props.allTags.length && props.allTags.length > 0,
  set: (val: boolean) => {
    if (val) emit('update:modelValue', [...props.allTags])
    else emit('update:modelValue', [])
  },
})

const indeterminate = computed(
  () => props.modelValue.length > 0 && props.modelValue.length < props.allTags.length,
)

function handleCheckAll(val: boolean | string | number) {
  checkAll.value = !!val
}

function updateValue(val: string[]) {
  emit('update:modelValue', val)
}
</script>

<style scoped>
.custom-header {
  .el-checkbox {
    display: flex;
    height: unset;
  }
}
</style>
