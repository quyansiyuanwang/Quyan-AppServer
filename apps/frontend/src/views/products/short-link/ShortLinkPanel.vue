<template>
  <section v-if="instance" class="resource-panel" v-loading="loading">
    <div class="toolbar">
      <div>
        <h2>{{ t('productResources.shortLinkTitle') }}</h2>
        <p>{{ t('productResources.shortLinkDescription') }}</p>
      </div>
      <el-button v-if="canWrite" type="primary" @click="openCreate">{{
        t('productResources.createShortLink')
      }}</el-button>
    </div>
    <el-alert v-if="error" type="error" :title="error" :closable="false"
      ><template #default
        ><el-button link @click="load">{{ t('productFeedback.retry') }}</el-button></template
      ></el-alert
    ><el-table v-if="canRead" :data="links"
      ><el-table-column
        prop="code"
        :label="t('productResources.shortCode')"
        min-width="120"
      /><el-table-column
        prop="targetUrl"
        :label="t('productResources.targetUrl')"
        min-width="240"
        show-overflow-tooltip
      /><el-table-column
        prop="clickCount"
        :label="t('productResources.clicks')"
        width="90"
      /><el-table-column :label="t('productResources.status')" width="90"
        ><template #default="{ row }"
          ><el-tag :type="row.enabled ? 'success' : 'info'">{{
            row.enabled ? t('productResources.enabled') : t('productResources.disabled')
          }}</el-tag></template
        ></el-table-column
      ><el-table-column :label="t('productResources.actions')" width="260" fixed="right"
        ><template #default="{ row }"
          ><el-button link @click="copyUrl(row.publicUrl)">{{ t('copy') }}</el-button
          ><el-button link @click="openAnalytics(row)">{{
            t('productResources.statistics')
          }}</el-button
          ><template v-if="canWrite"
            ><el-button link @click="edit(row)">{{ t('productResources.edit') }}</el-button
            ><el-button link :loading="submitting" @click="toggle(row)">{{
              row.enabled ? t('productResources.disabled') : t('productResources.enabled')
            }}</el-button></template
          ><el-button
            v-if="canManage"
            link
            type="danger"
            :loading="submitting"
            @click="remove(row)"
            >{{ t('productResources.delete') }}</el-button
          ></template
        ></el-table-column
      ></el-table
    ><el-empty v-else :description="t('productCatalog.noAccess')" /><el-empty
      v-if="canRead && !links.length && !loading"
      :description="t('productResources.empty')"
    />
    <el-dialog
      v-model="dialog"
      :title="editing ? t('productResources.edit') : t('productResources.createShortLink')"
      width="520px"
      destroy-on-close
      ><el-alert v-if="formError" type="error" :title="formError" :closable="false" /><el-form
        label-position="top"
        ><el-form-item :label="t('productResources.targetUrl')"
          ><el-input v-model="form.targetUrl" /></el-form-item
        ><el-form-item v-if="!editing" :label="t('productResources.customShortCode')"
          ><el-input v-model="form.code" /></el-form-item
        ><el-form-item :label="t('productResources.expiresAt')"
          ><el-date-picker
            v-model="form.expiresAt"
            type="datetime"
            style="width: 100%" /></el-form-item></el-form
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
import { useRouter } from 'vue-router'
import type { DeveloperProductInstanceDto, DeveloperShortLinkDto } from '@/client/types.gen'
import { Permission } from '@/constant/permission'
import { developerProductService } from '@/service/developerProductService'
import { i18ns } from '@/locales'
import { getErrorMessage } from '@/utils/error-utils'
const { t } = i18ns
const router = useRouter()
const props = defineProps<{
  instance?: DeveloperProductInstanceDto
  hasPermission: (permission: string) => boolean
}>()
const loading = ref(false),
  submitting = ref(false),
  error = ref(''),
  formError = ref(''),
  links = ref<DeveloperShortLinkDto[]>([]),
  dialog = ref(false),
  editing = ref<DeveloperShortLinkDto>(),
  form = ref({ targetUrl: '', code: '', expiresAt: null as Date | null })
let sequence = 0
const canRead = computed(() => props.hasPermission(Permission.PRODUCT_SHORT_LINK_READ)),
  canWrite = computed(() => props.hasPermission(Permission.PRODUCT_SHORT_LINK_WRITE)),
  canManage = computed(() => props.hasPermission(Permission.PRODUCT_SHORT_LINK_MANAGE))
const load = async () => {
  if (!props.instance || !canRead.value) {
    links.value = []
    return
  }
  const current = ++sequence
  loading.value = true
  error.value = ''
  try {
    const next = await developerProductService.listShortLinkResources(props.instance.id)
    if (current === sequence) links.value = next
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
  editing.value = undefined
  form.value = { targetUrl: '', code: '', expiresAt: null }
  formError.value = ''
  dialog.value = true
}
const edit = (row: DeveloperShortLinkDto) => {
  editing.value = row
  form.value = {
    targetUrl: row.targetUrl,
    code: '',
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
  }
  formError.value = ''
  dialog.value = true
}
const save = async () => {
  if (!props.instance || submitting.value) return
  if (!/^https?:\/\//i.test(form.value.targetUrl.trim())) {
    formError.value = t('productResources.invalidUrl')
    return
  }
  submitting.value = true
  formError.value = ''
  try {
    if (editing.value)
      await developerProductService.updateShortLinkResource(props.instance.id, editing.value.id, {
        targetUrl: form.value.targetUrl.trim(),
        expiresAt: form.value.expiresAt?.toISOString() ?? null,
      })
    else
      await developerProductService.createShortLinkResource(props.instance.id, {
        targetUrl: form.value.targetUrl.trim(),
        code: form.value.code.trim() || undefined,
        expiresAt: form.value.expiresAt?.toISOString(),
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
const toggle = async (row: DeveloperShortLinkDto) => {
  if (!props.instance || submitting.value) return
  submitting.value = true
  try {
    await developerProductService.updateShortLinkResource(props.instance.id, row.id, {
      enabled: !row.enabled,
    })
    await load()
    ElMessage.success(t('updateSuccess'))
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    submitting.value = false
  }
}
const remove = async (row: DeveloperShortLinkDto) => {
  if (!props.instance || submitting.value) return
  try {
    await ElMessageBox.confirm(`${t('delete')} ${row.code}?`, t('confirmDelete'), {
      type: 'warning',
    })
    submitting.value = true
    await developerProductService.deleteShortLinkResource(props.instance.id, row.id)
    await load()
    ElMessage.success(t('deleteSuccess'))
  } catch (cause) {
    if (cause !== 'cancel')
      ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    submitting.value = false
  }
}
const copy = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value)
    ElMessage.success(t('copySuccess'))
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  }
}

const copyUrl = async (value: string) => {
  await copy(import.meta.env.VITE_BACKEND_URL + value)
}

const openAnalytics = (row: DeveloperShortLinkDto) => {
  if (!props.instance || !canRead.value) return
  void router.push({
    name: 'product-short_link-analytics',
    params: { instanceId: props.instance.id, linkId: row.id },
  })
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
.toolbar p {
  margin: 0;
  color: var(--el-text-color-secondary);
}
</style>
