<template>
  <section class="json-product-panel" v-loading="loading">
    <header class="json-product-panel__header">
      <div>
        <h2>{{ instance.name }}</h2>
        <code>{{ endpoint?.publicUrl || instance.slug }}</code>
      </div>
      <el-tag v-if="endpoint" :type="endpoint.isPublic ? 'success' : 'warning'" size="small">
        {{ endpoint.isPublic ? i18ns.t('jsonEndpoint.public') : i18ns.t('jsonEndpoint.protected') }}
      </el-tag>
    </header>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <JsonEditor v-if="endpoint" v-model="draft" />
    <el-empty v-else-if="!loading" :description="i18ns.t('productFeedback.loadFailed')" />
    <footer
      v-if="endpoint && hasPermission(Permission.JSON_ENDPOINT_UPDATE)"
      class="json-product-panel__footer"
    >
      <el-button type="primary" :loading="saving" @click="save">{{ i18ns.t('save') }}</el-button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { DeveloperJsonEndpointDto, DeveloperProductInstanceDto } from '@/client/types.gen'
import JsonEditor from '@/components/editor/JsonEditor.vue'
import { developerProductService } from '@/service/developerProductService'
import { Permission } from '@/constant/permission'
import { i18ns } from '@/locales'

const props = defineProps<{
  instance: DeveloperProductInstanceDto
  hasPermission: (permission: string) => boolean
}>()
const endpoint = ref<DeveloperJsonEndpointDto>()
const draft = ref<unknown>({})
const loading = ref(false)
const saving = ref(false)
const error = ref('')

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    endpoint.value = await developerProductService.getJsonEndpointResource(props.instance.id)
    draft.value = JSON.parse(JSON.stringify(endpoint.value.jsonContent))
  } catch (cause: any) {
    endpoint.value = undefined
    error.value = cause?.message || i18ns.t('productFeedback.loadFailed')
  } finally {
    loading.value = false
  }
}

const save = async () => {
  if (!endpoint.value || saving.value) return
  saving.value = true
  try {
    endpoint.value = await developerProductService.updateJsonEndpointResource(
      endpoint.value.instanceId,
      draft.value,
    )
    draft.value = JSON.parse(JSON.stringify(endpoint.value.jsonContent))
    ElMessage.success(i18ns.t('productResources.save'))
  } catch (cause: any) {
    ElMessage.error(cause?.message || i18ns.t('operationFailed'))
  } finally {
    saving.value = false
  }
}

watch(() => props.instance.id, load, { immediate: true })
</script>

<style scoped>
.json-product-panel {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.json-product-panel__header,
.json-product-panel__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.json-product-panel__header h2 {
  margin: 0 0 6px;
  font-size: 18px;
}
.json-product-panel__header code {
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
.json-product-panel__footer {
  justify-content: flex-end;
}
</style>
