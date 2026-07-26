<template>
  <section v-if="instance" class="resource-panel" v-loading="loading">
    <div class="toolbar">
      <div>
        <h2>{{ t('productResources.kvTitle') }}</h2>
        <p>{{ t('productResources.kvDescription') }}</p>
      </div>
      <el-button v-if="canWrite" type="primary" @click="openCreate">{{
        t('productResources.newKv')
      }}</el-button>
    </div>
    <el-alert v-if="error" type="error" :title="error" :closable="false"
      ><template #default
        ><el-button link @click="load">{{ t('productFeedback.retry') }}</el-button></template
      ></el-alert
    ><el-table v-if="canRead" :data="entries"
      ><el-table-column prop="key" :label="t('productResources.key')" min-width="180"
        ><template #default="{ row }"
          ><code>{{ row.key }}</code></template
        ></el-table-column
      ><el-table-column
        prop="version"
        :label="t('productResources.version')"
        width="90"
      /><el-table-column :label="t('productResources.expiresAt')" min-width="170"
        ><template #default="{ row }">{{
          row.expiresAt
            ? new Date(row.expiresAt).toLocaleString()
            : t('productResources.neverExpires')
        }}</template></el-table-column
      ><el-table-column :label="t('productResources.actions')" width="170"
        ><template #default="{ row }"
          ><el-button link @click="edit(row)">{{ t('productResources.edit') }}</el-button
          ><el-button
            v-if="canWrite"
            link
            type="danger"
            :loading="submitting"
            @click="remove(row.key)"
            >{{ t('productResources.delete') }}</el-button
          ></template
        ></el-table-column
      ></el-table
    ><el-empty v-else :description="t('productCatalog.noAccess')" /><el-empty
      v-if="canRead && !entries.length && !loading"
      :description="t('productResources.empty')"
    />
    <el-dialog
      v-model="dialog"
      :title="editing ? t('productResources.edit') : t('productResources.newKv')"
      width="560px"
      destroy-on-close
      ><el-alert v-if="formError" type="error" :title="formError" :closable="false" /><el-form
        label-position="top"
        ><el-form-item :label="t('productResources.key')"
          ><el-input v-model="form.key" :disabled="editing" /></el-form-item
        ><el-form-item :label="t('productResources.jsonValue')"
          ><el-input v-model="form.value" type="textarea" :rows="8" /></el-form-item
        ><el-form-item :label="t('productResources.ttlSeconds')"
          ><el-input-number v-model="form.ttlSeconds" :min="1" />
          <p class="field-hint">{{ t('productResources.ttlHint') }}</p></el-form-item
        ></el-form
      ><template #footer
        ><el-button @click="dialog = false">{{ t('cancel') }}</el-button
        ><el-button type="primary" :loading="submitting" @click="save">{{
          t('productResources.save')
        }}</el-button></template
      ></el-dialog
    >
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { DeveloperKvValueDto, DeveloperProductInstanceDto } from '@/client/types.gen'
import { Permission } from '@/constant/permission'
import { developerProductService } from '@/service/developerProductService'
import { i18ns } from '@/locales'
import { getErrorMessage } from '@/utils/error-utils'
const { t } = i18ns
const props = defineProps<{
  instance?: DeveloperProductInstanceDto
  hasPermission: (permission: string) => boolean
}>()
type Summary = Pick<DeveloperKvValueDto, 'key' | 'version' | 'expiresAt' | 'updateTime'>
const loading = ref(false),
  submitting = ref(false),
  error = ref(''),
  formError = ref(''),
  entries = ref<Summary[]>([]),
  dialog = ref(false),
  editing = ref(false),
  form = ref({ key: '', value: '{}', ttlSeconds: undefined as number | undefined })
let sequence = 0
const canRead = computed(() => props.hasPermission(Permission.PRODUCT_KV_READ))
const canWrite = computed(() => props.hasPermission(Permission.PRODUCT_KV_WRITE))
const load = async () => {
  if (!props.instance || !canRead.value) {
    entries.value = []
    return
  }
  const current = ++sequence
  loading.value = true
  error.value = ''
  try {
    const next = await developerProductService.listKvResources(props.instance.id)
    if (current === sequence) entries.value = next as Summary[]
  } catch (cause) {
    if (current === sequence) {
      error.value = getErrorMessage(cause, t('productFeedback.loadFailed'))
      ElMessage.error(error.value)
    }
  } finally {
    if (current === sequence) loading.value = false
  }
}
const openCreate = () => {
  editing.value = false
  form.value = { key: '', value: '{}', ttlSeconds: undefined }
  formError.value = ''
  dialog.value = true
}
const edit = async (row: Summary) => {
  if (!props.instance || !canRead.value) return
  submitting.value = true
  formError.value = ''
  try {
    const detail = await developerProductService.getKvResource(props.instance.id, row.key)
    const expiresAt = detail.expiresAt ? new Date(detail.expiresAt).getTime() : 0
    editing.value = true
    form.value = {
      key: detail.key,
      value: JSON.stringify(detail.value, null, 2),
      ttlSeconds: expiresAt ? Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)) : undefined,
    }
    dialog.value = true
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    submitting.value = false
  }
}
const save = async () => {
  if (!props.instance || submitting.value) return
  if (!form.value.key.trim()) {
    formError.value = t('required')
    return
  }
  submitting.value = true
  formError.value = ''
  try {
    await developerProductService.setKvResource(props.instance.id, form.value.key.trim(), {
      value: JSON.parse(form.value.value),
      ttlSeconds: form.value.ttlSeconds,
    })
    dialog.value = false
    await load()
    ElMessage.success(t('productResources.kvSaved'))
  } catch (cause) {
    formError.value =
      cause instanceof SyntaxError
        ? t('productResources.kvInvalid')
        : getErrorMessage(cause, t('productFeedback.operationFailed'))
    ElMessage.error(formError.value)
  } finally {
    submitting.value = false
  }
}
const remove = async (key: string) => {
  if (!props.instance || submitting.value) return
  try {
    await ElMessageBox.confirm(`${t('delete')} ${key}?`, t('confirmDelete'), { type: 'warning' })
    submitting.value = true
    await developerProductService.deleteKvResource(props.instance.id, key)
    await load()
    ElMessage.success(t('deleteSuccess'))
  } catch (cause) {
    if (cause !== 'cancel')
      ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    submitting.value = false
  }
}
watch(() => [props.instance?.id, canRead.value], load, { immediate: true })
</script>
<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}
.toolbar h2 {
  margin: 0 0 6px;
  font-size: 17px;
}
.toolbar p,
.field-hint {
  margin: 0;
  color: var(--el-text-color-secondary);
}
.field-hint {
  margin-top: 6px;
  font-size: 12px;
}
</style>
