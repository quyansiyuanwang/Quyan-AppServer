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
          <el-button v-if="canWrite" link :loading="submitting" @click="check(row.id)">{{
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
      width="520px"
      destroy-on-close
    >
      <el-alert v-if="formError" type="error" :title="formError" :closable="false" />
      <el-form label-position="top">
        <el-form-item :label="t('productResources.name')"
          ><el-input v-model="form.name"
        /></el-form-item>
        <el-form-item :label="t('productResources.targetUrl')"
          ><el-input v-model="form.targetUrl"
        /></el-form-item>
        <el-form-item :label="t('productResources.method')"
          ><el-select v-model="form.method"
            ><el-option label="GET" value="GET" /><el-option label="HEAD" value="HEAD" /></el-select
        ></el-form-item>
        <el-form-item :label="t('productResources.intervalSeconds')"
          ><el-input-number v-model="form.intervalSec" :min="60"
        /></el-form-item>
        <el-form-item :label="t('productResources.successStatusCodes')"
          ><el-input v-model="form.successStatusCodesText" placeholder="200, 201, 204"
        /></el-form-item>
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
const form = ref({
  name: '',
  targetUrl: '',
  method: 'GET' as 'GET' | 'HEAD',
  intervalSec: 60,
  successStatusCodesText: '200',
})
let sequence = 0

const canRead = computed(() => props.hasPermission(Permission.PRODUCT_STATUS_READ))
const canWrite = computed(() => props.hasPermission(Permission.PRODUCT_STATUS_WRITE))
const canPublish = computed(() => props.hasPermission(Permission.PRODUCT_STATUS_PUBLISH))
const canManage = computed(() => props.hasPermission(Permission.PRODUCT_STATUS_MANAGE))

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
    method: 'GET',
    intervalSec: 60,
    successStatusCodesText: '200',
  }
  formError.value = ''
  dialog.value = true
}
const edit = (row: DeveloperStatusMonitorDto) => {
  editing.value = row
  form.value = {
    name: row.name,
    targetUrl: row.targetUrl,
    method: row.method as 'GET' | 'HEAD',
    intervalSec: row.intervalSec,
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
const save = async () => {
  if (!props.instance || submitting.value || !canWrite.value) return
  if (!form.value.name.trim() || !/^https?:\/\//i.test(form.value.targetUrl.trim())) {
    formError.value = !form.value.name.trim() ? t('required') : t('productResources.invalidUrl')
    return
  }
  const successStatusCodes = statusCodes()
  if (!successStatusCodes.length) {
    formError.value = t('productResources.invalidStatusCodes')
    return
  }
  submitting.value = true
  formError.value = ''
  const body: CreateDeveloperStatusMonitorDto = {
    name: form.value.name.trim(),
    targetUrl: form.value.targetUrl.trim(),
    method: form.value.method,
    intervalSec: form.value.intervalSec,
    successStatusCodes,
  }
  try {
    if (editing.value) {
      const update: UpdateDeveloperStatusMonitorDto = body
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
  if (!props.instance || submitting.value || !canWrite.value) return
  submitting.value = true
  try {
    await developerProductService.checkMonitorResource(props.instance.id, id)
    await load()
    ElMessage.success(t('success'))
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    submitting.value = false
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
  window.open(`/status/${encodeURIComponent(statusPageSlug.value)}`, '_blank', 'noopener,noreferrer')
}

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
</style>
