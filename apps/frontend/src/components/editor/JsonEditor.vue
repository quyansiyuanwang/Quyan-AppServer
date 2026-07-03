<template>
  <div class="json-editor">
    <div class="editor-tabs">
      <el-radio-group v-model="editMode" size="small">
        <el-radio-button value="visual">{{ i18ns.t('jsonEndpoint.visualEditor') }}</el-radio-button>
        <el-radio-button value="code">{{ i18ns.t('jsonEndpoint.codeEditor') }}</el-radio-button>
      </el-radio-group>
    </div>

    <!-- Visual Editor -->
    <div v-if="editMode === 'visual'" class="visual-editor">
      <el-scrollbar max-height="400px">
        <div class="json-tree">
          <JsonNode
            :key="componentKey"
            :model-value="visualData"
            :path="[]"
            :is-root="true"
            @update:model-value="handleVisualDataUpdate"
          />
        </div>
      </el-scrollbar>
    </div>

    <!-- Code Editor -->
    <div v-else class="code-editor">
      <el-input
        v-model="codeText"
        type="textarea"
        :rows="12"
        :placeholder="i18ns.t('jsonEndpoint.jsonPlaceholder')"
        @blur="handleCodeBlur"
      />
      <div v-if="parseError" class="error-message">
        <el-icon><WarningFilled /></el-icon>
        {{ parseError }}
      </div>
    </div>

    <!-- Quick Templates -->
    <div class="template-section">
      <el-divider content-position="left">
        <span class="template-title">{{ i18ns.t('jsonEndpoint.quickTemplates') }}</span>
      </el-divider>
      <div class="template-buttons">
        <el-button size="small" @click="applyTemplate('object')">
          {{ i18ns.t('jsonEndpoint.emptyObject') }}
        </el-button>
        <el-button size="small" @click="applyTemplate('array')">
          {{ i18ns.t('jsonEndpoint.emptyArray') }}
        </el-button>
        <el-button size="small" @click="applyTemplate('config')">
          {{ i18ns.t('jsonEndpoint.configTemplate') }}
        </el-button>
        <el-button size="small" @click="applyTemplate('api')">
          {{ i18ns.t('jsonEndpoint.apiTemplate') }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { i18ns } from '@/locales'
import { WarningFilled } from '@element-plus/icons-vue'
import JsonNode from './JsonNode.vue'

const props = defineProps<{
  modelValue: any
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: any): void
}>()

const editMode = ref<'visual' | 'code'>('visual')
const visualData = ref<any>({})
const codeText = ref('')
const parseError = ref('')
const isInternalUpdate = ref(false)
const componentKey = ref(0)

// Watch prop changes from parent - 使用 immediate 确保初始化
watch(
  () => props.modelValue,
  (newValue) => {
    // 如果是内部更新触发的，跳过
    if (isInternalUpdate.value) {
      isInternalUpdate.value = false
      return
    }

    if (newValue && typeof newValue === 'object') {
      visualData.value = JSON.parse(JSON.stringify(newValue))
      codeText.value = JSON.stringify(newValue, null, 2)
    } else {
      visualData.value = {}
      codeText.value = '{}'
    }

    // 强制重新渲染 JsonNode 组件
    componentKey.value++
  },
  { immediate: true, deep: true },
)

// Watch mode changes
watch(editMode, (newMode) => {
  if (newMode === 'code') {
    // Switching to code mode
    codeText.value = JSON.stringify(visualData.value, null, 2)
    parseError.value = ''
  } else {
    // Switching to visual mode
    try {
      const parsed = JSON.parse(codeText.value)
      visualData.value = parsed
      parseError.value = ''
      // 强制重新渲染
      componentKey.value++
    } catch (error: any) {
      parseError.value = error.message
    }
  }
})

// Handle visual data update from JsonNode
const handleVisualDataUpdate = (newValue: any) => {
  visualData.value = newValue
  isInternalUpdate.value = true
  emit('update:modelValue', JSON.parse(JSON.stringify(newValue)))
}

// Handle code editor blur
const handleCodeBlur = () => {
  try {
    const parsed = JSON.parse(codeText.value)
    visualData.value = parsed
    parseError.value = ''
    isInternalUpdate.value = true
    emit('update:modelValue', parsed)
    componentKey.value++
  } catch (error: any) {
    parseError.value = error.message
  }
}

// Apply templates
const applyTemplate = (type: string) => {
  let template: any
  switch (type) {
    case 'object':
      template = {}
      break
    case 'array':
      template = []
      break
    case 'config':
      template = {
        version: '1.0.0',
        enabled: true,
        settings: {
          timeout: 30,
          retries: 3,
        },
      }
      break
    case 'api':
      template = {
        status: 'success',
        data: {
          items: [],
          total: 0,
        },
        message: 'OK',
      }
      break
    default:
      template = {}
  }

  visualData.value = template
  codeText.value = JSON.stringify(template, null, 2)
  isInternalUpdate.value = true
  emit('update:modelValue', template)
  componentKey.value++
}
</script>

<style scoped>
.json-editor {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  overflow: hidden;
}

.editor-tabs {
  padding: 12px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color);
}

.visual-editor {
  padding: 16px;
  background: var(--el-bg-color);
}

.json-tree {
  min-height: 200px;
}

.code-editor {
  padding: 16px;
}

.error-message {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  border-radius: 4px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.template-section {
  padding: 12px 16px;
  background: var(--el-fill-color-lighter);
  border-top: 1px solid var(--el-border-color);
}

.template-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.template-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
