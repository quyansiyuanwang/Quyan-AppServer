<template>
  <el-dialog
    :model-value="visible"
    :title="title"
    width="700px"
    :close-on-click-modal="false"
    class="sm-dialog"
    @update:model-value="emit('update:visible', $event)"
    @closed="emit('closed')"
  >
    <el-form ref="formRef" :model="formData" :rules="formRules" label-width="80px">
      <el-form-item :label="i18ns.t('scriptManager.name')" prop="name">
        <el-input :model-value="formData.name" @update:model-value="updateField('name', $event)" />
      </el-form-item>
      <el-form-item :label="i18ns.t('scriptManager.description')">
        <el-input
          :model-value="formData.description"
          type="textarea"
          :rows="2"
          @update:model-value="updateField('description', $event)"
        />
      </el-form-item>
      <div class="sm-editor-warning">
        <span class="sm-editor-warning-icon">⚠</span>
        <span>{{ i18ns.t('scriptManager.editorWarning') }}</span>
      </div>
      <el-form-item :label="i18ns.t('scriptManager.content')" prop="content">
        <el-input
          :model-value="formData.content"
          type="textarea"
          :rows="14"
          :placeholder="i18ns.t('scriptManager.contentPlaceholder')"
          style="font-size: 13px"
          @update:model-value="updateField('content', $event)"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="emit('update:visible', false)">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="emit('save')">{{ i18ns.t('save') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { i18ns } from '@/locales'
import type { ScriptFormData } from '../types'

const props = defineProps<{
  visible: boolean
  title: string
  saving: boolean
  formData: ScriptFormData
  formRules: FormRules<ScriptFormData>
}>()

const emit = defineEmits<{
  save: []
  closed: []
  'update:visible': [value: boolean]
  'update:formData': [value: ScriptFormData]
}>()

const formRef = ref<FormInstance>()

function updateField<K extends keyof ScriptFormData>(key: K, value: ScriptFormData[K]) {
  emit('update:formData', {
    ...props.formData,
    [key]: value,
  })
}

defineExpose({
  async validate() {
    if (!formRef.value) return false
    return formRef.value.validate().catch(() => false)
  },
  clearValidate() {
    formRef.value?.clearValidate()
  },
})
</script>

<style scoped>
.sm-editor-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid rgba(232, 160, 32, 0.4);
  background: rgba(232, 160, 32, 0.08);
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.5;
}

.sm-editor-warning-icon {
  flex-shrink: 0;
  color: #e8a020;
}
</style>