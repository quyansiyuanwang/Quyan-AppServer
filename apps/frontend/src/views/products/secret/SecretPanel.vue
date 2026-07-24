<template>
  <section v-if="instance" class="resource-panel" v-loading="loading">
    <div class="toolbar">
      <div>
        <h2>{{ t('productResources.secretTitle') }}</h2>
        <p>{{ t('productResources.secretDescription') }}</p>
      </div>
      <el-button v-if="canWrite" type="primary" @click="openCreate">{{
        t('productResources.writeSecret')
      }}</el-button>
    </div>
    <el-alert v-if="error" type="error" :title="error" :closable="false"
      ><template #default
        ><el-button link @click="load">{{ t('productFeedback.retry') }}</el-button></template
      ></el-alert
    ><el-table v-if="canRead" :data="secrets"
      ><el-table-column prop="alias" :label="t('productResources.key')" min-width="200"
        ><template #default="{ row }"
          ><code>{{ row.alias }}</code></template
        ></el-table-column
      ><el-table-column
        prop="keyVersion"
        :label="t('productResources.version')"
        width="90"
      /><el-table-column :label="t('productResources.lastUsed')" min-width="170"
        ><template #default="{ row }">{{
          row.lastUsedAt
            ? new Date(row.lastUsedAt).toLocaleString()
            : t('productResources.neverUsed')
        }}</template></el-table-column
      ><el-table-column :label="t('productResources.actions')" width="150"
        ><template #default="{ row }"
          ><el-button v-if="canWrite" link @click="rotate(row.alias)">{{
            t('productResources.rotate')
          }}</el-button
          ><el-button
            v-if="canManage"
            link
            type="danger"
            :loading="submitting"
            @click="remove(row.alias)"
            >{{ t('productResources.delete') }}</el-button
          ></template
        ></el-table-column
      ></el-table
    ><el-empty v-else :description="t('productCatalog.noAccess')" /><el-empty
      v-if="canRead && !secrets.length && !loading"
      :description="t('productResources.empty')"
    /><el-dialog
      v-model="dialog"
      :title="rotating ? t('productResources.rotate') : t('productResources.writeSecret')"
      width="500px"
      destroy-on-close
      ><el-alert v-if="formError" type="error" :title="formError" :closable="false" /><el-form
        label-position="top"
        ><el-form-item :label="t('productResources.key')"
          ><el-input
            v-model="form.alias"
            :disabled="rotating"
            maxlength="100"
            placeholder="OPENAI_KEY"
            @input="normalizeAlias"
          /><p class="field-hint">{{ t('productResources.secretAliasHint') }}</p></el-form-item
        ><el-form-item :label="t('productResources.secretValue')"
          ><el-input v-model="form.value" type="password" show-password /></el-form-item></el-form
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
import type { DeveloperProductInstanceDto, DeveloperSecretDto } from '@/client/types.gen'
import { Permission } from '@/constant/permission'
import { developerProductService } from '@/service/developerProductService'
import { i18ns } from '@/locales'
import { getErrorMessage } from '@/utils/error-utils'
const { t } = i18ns
const props = defineProps<{
  instance?: DeveloperProductInstanceDto
  hasPermission: (permission: string) => boolean
}>()
const loading = ref(false),
  submitting = ref(false),
  error = ref(''),
  formError = ref(''),
  secrets = ref<DeveloperSecretDto[]>([]),
  dialog = ref(false),
  rotating = ref(false),
  form = ref({ alias: '', value: '' })
let sequence = 0
const canRead = computed(() => props.hasPermission(Permission.PRODUCT_SECRET_READ)),
  canWrite = computed(() => props.hasPermission(Permission.PRODUCT_SECRET_WRITE)),
  canManage = computed(() => props.hasPermission(Permission.PRODUCT_SECRET_MANAGE))
const load = async () => {
  if (!props.instance || !canRead.value) {
    secrets.value = []
    return
  }
  const current = ++sequence
  loading.value = true
  error.value = ''
  try {
    const next = await developerProductService.listSecretResources(props.instance.id)
    if (current === sequence) secrets.value = next
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
  rotating.value = false
  form.value = { alias: '', value: '' }
  formError.value = ''
  dialog.value = true
}
const rotate = (alias: string) => {
  rotating.value = true
  form.value = { alias, value: '' }
  formError.value = ''
  dialog.value = true
}
const normalizeAlias = (value: string) => {
  form.value.alias = value.toUpperCase()
}
const save = async () => {
  if (!props.instance || submitting.value) return
  if (!form.value.alias.trim() || !form.value.value) {
    formError.value = t('required')
    return
  }
  if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(form.value.alias.trim())) {
    formError.value = t('productResources.invalidSecretAlias')
    return
  }
  submitting.value = true
  formError.value = ''
  try {
    await developerProductService.upsertSecretResource(props.instance.id, {
      alias: form.value.alias.trim(),
      value: form.value.value,
    })
    dialog.value = false
    await load()
    ElMessage.success(t('updateSuccess'))
  } catch (cause) {
    formError.value = getErrorMessage(cause, t('productFeedback.operationFailed'))
    ElMessage.error(formError.value)
  } finally {
    submitting.value = false
  }
}
const remove = async (alias: string) => {
  if (!props.instance || submitting.value) return
  try {
    await ElMessageBox.confirm(`${t('delete')} ${alias}?`, t('confirmDelete'), { type: 'warning' })
    submitting.value = true
    await developerProductService.deleteSecretResource(props.instance.id, alias)
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
.field-hint {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
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
.toolbar p {
  margin: 0;
  color: var(--el-text-color-secondary);
}
</style>
