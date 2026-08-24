<template>
  <section v-if="instance" class="resource-panel" v-loading="loading">
    <div class="toolbar">
      <div>
        <h2>{{ t('productResources.statusTitle') }}</h2>
        <p>{{ t('productResources.statusDescription') }}</p>
      </div>
      <div class="toolbar-actions">
        <el-button
          v-if="published && statusPageSlug"
          :icon="TopRight"
          @click="openPublicStatusPage"
        >
          {{ t('productResources.openStatusPage') }}
        </el-button>
        <el-button v-if="canPublish" plain :loading="submitting" @click="togglePublished">{{
          published ? t('productResources.unpublish') : t('productResources.publish')
        }}</el-button>
        <el-button v-if="canWrite" type="primary" @click="openCreate">{{
          t('productResources.addTarget')
        }}</el-button>
      </div>
    </div>
    <el-alert v-if="error" type="error" :title="error" :closable="false"
      ><template #default
        ><el-button link @click="load">{{ t('productFeedback.retry') }}</el-button></template
      ></el-alert
    >
    <el-table v-if="canRead" :data="monitors">
      <el-table-column prop="name" :label="t('productResources.name')" min-width="130" />
      <el-table-column
        prop="targetUrl"
        :label="t('productResources.targetUrl')"
        min-width="220"
        show-overflow-tooltip
      />
      <el-table-column prop="method" :label="t('productResources.method')" width="90" />
      <el-table-column
        :label="t('productResources.responseBodyMatch')"
        min-width="180"
        show-overflow-tooltip
      >
        <template #default="{ row }">{{ responseBodyMatchSummary(row) }}</template>
      </el-table-column>
      <el-table-column prop="lastStatus" :label="t('productResources.latestStatus')" width="110" />
      <el-table-column :label="t('productResources.status')" width="90"
        ><template #default="{ row }"
          ><el-tag :type="row.enabled ? 'success' : 'info'">{{
            row.enabled ? t('productResources.enabled') : t('productResources.pause')
          }}</el-tag></template
        ></el-table-column
      >
      <el-table-column :label="t('productResources.actions')" width="250" fixed="right"
        ><template #default="{ row }">
          <el-button v-if="canWrite" link :loading="checkingIds.has(row.id)" @click="check(row.id)">{{
            t('productResources.runCheck')
          }}</el-button>
          <el-button v-if="canWrite" link @click="edit(row)">{{
            t('productResources.edit')
          }}</el-button>
          <el-button v-if="canWrite" link :loading="submitting" @click="toggle(row)">{{
            row.enabled ? t('productResources.pause') : t('productResources.resume')
          }}</el-button>
          <el-button
            v-if="canManage"
            link
            type="danger"
            :loading="submitting"
            @click="remove(row)"
            >{{ t('productResources.delete') }}</el-button
          >
        </template></el-table-column
      >
    </el-table>
    <el-empty v-else :description="t('productCatalog.noAccess')" />
    <el-empty
      v-if="canRead && !monitors.length && !loading"
      :description="t('productResources.empty')"
    />
    <el-dialog
      v-model="dialog"
      :title="editing ? t('productResources.edit') : t('productResources.addTarget')"
      width="620px"
      destroy-on-close
    >
      <el-alert v-if="formError" type="error" :title="formError" :closable="false" />
      <el-form label-position="top">
        <el-form-item :label="t('productResources.name')"
          ><el-input v-model="form.name"
        /></el-form-item>
        <el-form-item :label="t('productResources.targetUrl')">
          <div class="target-url-input">
            <el-select v-model="form.protocol" class="target-url-protocol">
              <el-option label="https://" value="https:" />
              <el-option label="http://" value="http:" />
            </el-select>
            <el-input v-model="form.targetUrl" :placeholder="t('productResources.targetUrlPlaceholder')" />
          </div>
        </el-form-item>
        <el-form-item :label="t('productResources.method')"
          ><el-select v-model="form.method"
            ><el-option label="GET" value="GET" /><el-option label="HEAD" value="HEAD" />
            <el-option label="POST" value="POST" /><el-option label="PUT" value="PUT" />
            <el-option label="PATCH" value="PATCH" /><el-option
              label="DELETE"
              value="DELETE" /></el-select
        ></el-form-item>
        <el-form-item v-if="supportsRequestBody" :label="t('productResources.requestPayload')">
          <el-input
            v-model="form.requestBody"
            type="textarea"
            :rows="5"
            :placeholder="t('productResources.requestPayloadHint')"
          />
        </el-form-item>
        <el-form-item :label="t('productResources.intervalSeconds')"
          ><el-input-number v-model="form.intervalSec" :min="60"
        /></el-form-item>
        <el-form-item :label="t('productResources.alertDelayMinutes')"
          ><el-input-number v-model="form.alertDelayMinutes" :min="1" :max="1440"
        /></el-form-item>
        <el-form-item :label="t('productResources.successStatusCodes')"
          ><el-input v-model="form.successStatusCodesText" placeholder="200, 201, 204"
        /></el-form-item>
        <el-form-item
          v-if="supportsResponseBodyMatch"
          :label="t('productResources.responseBodyMatchMode')"
        >
          <el-select
            v-model="form.responseBodyMatchMode"
            clearable
            :placeholder="t('productResources.responseBodyMatchDisabled')"
          >
            <el-option :label="t('productResources.responseBodyMatchContains')" value="contains" />
            <el-option :label="t('productResources.responseBodyMatchEquals')" value="equals" />
          </el-select>
        </el-form-item>
        <el-form-item
          v-if="supportsResponseBodyMatch && form.responseBodyMatchMode"
          :label="t('productResources.responseBodyExpected')"
        >
          <el-input v-model="form.responseBodyMatch" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer
        ><el-button @click="dialog = false">{{ t('cancel') }}</el-button
        ><el-button type="primary" :loading="submitting" @click="save">{{
          t('productResources.save')
        }}</el-button></template
      >
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { TopRight } from '@element-plus/icons-vue'
import type {
  CreateDeveloperStatusMonitorDto,
  DeveloperProductInstanceDto,
  DeveloperStatusMonitorDto,
  UpdateDeveloperStatusMonitorDto,
} from '@/client/types.gen'
import { Permission } from '@/constant/permission'
import { developerProductService } from '@/service/developerProductService'
import { i18ns } from '@/locales'
import { getErrorMessage } from '@/utils/error-utils'

const { t } = i18ns
const props = defineProps<{
  instance?: DeveloperProductInstanceDto
  hasPermission: (permission: string) => boolean
}>()
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const formError = ref('')
const monitors = ref<DeveloperStatusMonitorDto[]>([])
const dialog = ref(false)
const editing = ref<DeveloperStatusMonitorDto>()
const published = ref(false)
const statusPageSlug = ref('')
type StatusMonitorMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type ResponseBodyMatchMode = 'contains' | 'equals'
const form = ref({
  name: '',
  targetUrl: '',
  protocol: 'https:' as 'http:' | 'https:',
  method: 'GET' as StatusMonitorMethod,
  requestBody: '',
  responseBodyMatchMode: undefined as ResponseBodyMatchMode | undefined,
  responseBodyMatch: '',
  intervalSec: 60,
  alertDelayMinutes: 5,
  successStatusCodesText: '200',
})
let sequence = 0

const canRead = computed(() => props.hasPermission(Permission.PRODUCT_STATUS_READ))
const canWrite = computed(() => props.hasPermission(Permission.PRODUCT_STATUS_WRITE))
const canPublish = computed(() => props.hasPermission(Permission.PRODUCT_STATUS_PUBLISH))
const canManage = computed(() => props.hasPermission(Permission.PRODUCT_STATUS_MANAGE))
const supportsRequestBody = computed(() =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(form.value.method),
)
const supportsResponseBodyMatch = computed(() => form.value.method !== 'HEAD')
const checkingIds = ref(new Set<string>())

const load = async () => {
  if (!props.instance) {
    monitors.value = []
    published.value = false
    statusPageSlug.value = ''
    return
  }
  const instanceId = props.instance.id
  const current = ++sequence
  loading.value = true
  error.value = ''
  try {
    const [nextMonitors, page] = await Promise.all([
      canRead.value
        ? developerProductService.listMonitorResources(instanceId)
        : Promise.resolve([]),
      canPublish.value
        ? developerProductService.getStatusPageResource(instanceId)
        : Promise.resolve(undefined),
    ])
    if (current !== sequence || props.instance?.id !== instanceId) return
    monitors.value = nextMonitors
    published.value = Boolean(page?.statusPagePublished)
    statusPageSlug.value = page?.slug || ''
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
  form.value = {
    name: '',
    targetUrl: '',
    protocol: 'https:',
    method: 'GET',
    requestBody: '',
    responseBodyMatchMode: undefined,
    responseBodyMatch: '',
    intervalSec: 60,
    alertDelayMinutes: 5,
    successStatusCodesText: '200',
  }
  formError.value = ''
  dialog.value = true
}
const edit = (row: DeveloperStatusMonitorDto) => {
  editing.value = row
  form.value = {
    name: row.name,
    targetUrl: row.targetUrl.replace(/^https?:\/\//i, ''),
    protocol: row.targetUrl.startsWith('http:') ? 'http:' : 'https:',
    method: row.method as StatusMonitorMethod,
    requestBody: row.requestBody || '',
    responseBodyMatchMode: row.responseBodyMatchMode,
    responseBodyMatch: row.responseBodyMatch || '',
    intervalSec: row.intervalSec,
    alertDelayMinutes: row.alertDelayMinutes || 5,
    successStatusCodesText: (row.successStatusCodes || [200]).join(', '),
  }
  formError.value = ''
  dialog.value = true
}
const statusCodes = () =>
  form.value.successStatusCodesText
    .split(',')
    .map((code) => Number(code.trim()))
    .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599)
const responseBodyMatchSummary = (row: DeveloperStatusMonitorDto) => {
  if (!row.responseBodyMatchMode || !row.responseBodyMatch) return '-'
  const mode =
    row.responseBodyMatchMode === 'equals'
      ? t('productResources.responseBodyMatchEquals')
      : t('productResources.responseBodyMatchContains')
  return `${mode}: ${row.responseBodyMatch}`
}
const save = async () => {
  if (!props.instance || submitting.value || !canWrite.value) return
  const targetUrl = form.value.protocol + '//' + form.value.targetUrl.trim()
  let parsedTarget: URL | undefined
  try {
    parsedTarget = new URL(targetUrl)
  } catch {
    parsedTarget = undefined
  }
  if (
    !form.value.name.trim() ||
    /^file:/i.test(form.value.targetUrl.trim()) ||
    !parsedTarget?.hostname ||
    parsedTarget.protocol === 'file:'
  ) {
    formError.value = !form.value.name.trim() ? t('required') : t('productResources.invalidUrl')
    return
  }
  const successStatusCodes = statusCodes()
  if (!successStatusCodes.length) {
    formError.value = t('productResources.invalidStatusCodes')
    return
  }
  const requestBody = form.value.requestBody.trim() ? form.value.requestBody : undefined
  if (requestBody) {
    try {
      JSON.parse(requestBody)
    } catch {
      formError.value = t('productResources.invalidRequestPayload')
      return
    }
  }
  const responseBodyMatch = form.value.responseBodyMatch.trim()
    ? form.value.responseBodyMatch
    : undefined
  if (form.value.responseBodyMatchMode && !responseBodyMatch) {
    formError.value = t('productResources.responseBodyMatchRequired')
    return
  }
  submitting.value = true
  formError.value = ''
  const body: CreateDeveloperStatusMonitorDto = {
    name: form.value.name.trim(),
    targetUrl,
    method: form.value.method,
    intervalSec: form.value.intervalSec,
    alertDelayMinutes: form.value.alertDelayMinutes,
    successStatusCodes,
    ...(requestBody ? { requestBody } : {}),
    ...(form.value.responseBodyMatchMode && responseBodyMatch
      ? {
          responseBodyMatchMode: form.value.responseBodyMatchMode,
          responseBodyMatch,
        }
      : {}),
  }
  try {
    if (editing.value) {
      const update: UpdateDeveloperStatusMonitorDto = {
        ...body,
        requestBody: requestBody ?? null,
        responseBodyMatchMode: form.value.responseBodyMatchMode ?? null,
        responseBodyMatch: responseBodyMatch ?? null,
      }
      await developerProductService.updateMonitorResource(
        props.instance.id,
        editing.value.id,
        update,
      )
    } else await developerProductService.createMonitorResource(props.instance.id, body)
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
const toggle = async (row: DeveloperStatusMonitorDto) => {
  if (!props.instance || submitting.value || !canWrite.value) return
  submitting.value = true
  try {
    await developerProductService.updateMonitorResource(props.instance.id, row.id, {
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
const check = async (id: string) => {
  if (!props.instance || checkingIds.value.has(id) || !canWrite.value) return
  checkingIds.value = new Set(checkingIds.value).add(id)
  try {
    await developerProductService.checkMonitorResource(props.instance.id, id)
    await load()
    ElMessage.success(t('success'))
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    const next = new Set(checkingIds.value)
    next.delete(id)
    checkingIds.value = next
  }
}
const remove = async (row: DeveloperStatusMonitorDto) => {
  if (!props.instance || submitting.value || !canManage.value) return
  try {
    await ElMessageBox.confirm(`${t('delete')} ${row.name}?`, t('confirmDelete'), {
      type: 'warning',
    })
    submitting.value = true
    await developerProductService.deleteMonitorResource(props.instance.id, row.id)
    await load()
    ElMessage.success(t('deleteSuccess'))
  } catch (cause) {
    if (cause !== 'cancel')
      ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    submitting.value = false
  }
}
const togglePublished = async () => {
  if (!props.instance || submitting.value || !canPublish.value) return
  const previous = published.value
  submitting.value = true
  try {
    await developerProductService.updateStatusPageResource(props.instance.id, {
      published: !previous,
    })
    await load()
    ElMessage.success(t('updateSuccess'))
  } catch (cause) {
    published.value = previous
    ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    submitting.value = false
  }
}
const openPublicStatusPage = () => {
  if (!statusPageSlug.value) return
  window.open(
    `/status/${encodeURIComponent(statusPageSlug.value)}`,
    '_blank',
    'noopener,noreferrer',
  )
}

watch(
  () => form.value.method,
  (method) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) form.value.requestBody = ''
    if (method === 'HEAD') {
      form.value.responseBodyMatchMode = undefined
      form.value.responseBodyMatch = ''
    }
  },
)
watch(() => [props.instance?.id, canRead.value, canPublish.value], load, { immediate: true })
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
.toolbar-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.target-url-input {
  display: flex;
  gap: 8px;
  width: 100%;
}
.target-url-protocol {
  width: 112px;
  flex: 0 0 112px;
}
</style>
