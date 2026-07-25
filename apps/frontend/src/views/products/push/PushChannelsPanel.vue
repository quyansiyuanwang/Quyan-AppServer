<template>
  <section v-if="instance" class="resource-panel">
    <div class="toolbar">
      <div>
        <h2>{{ t('productResources.pushTitle') }}</h2>
        <p>{{ t('productResources.pushDescription') }}</p>
      </div>
      <el-button v-if="canManageChannels" type="primary" @click="openCreate">
        {{ t('productResources.addChannel') }}
      </el-button>
    </div>

    <el-alert v-if="channelError" type="error" :title="channelError" :closable="false">
      <template #default
        ><el-button link @click="loadChannels">{{
          t('productFeedback.retry')
        }}</el-button></template
      >
    </el-alert>
    <el-table v-if="canManageChannels" v-loading="channelsLoading" :data="channels">
      <el-table-column prop="name" :label="t('productResources.name')" min-width="140" />
      <el-table-column :label="t('productResources.type')" width="140">
        <template #default="{ row }">{{ pushChannelTypeLabel(row.type) }}</template>
      </el-table-column>
      <el-table-column
        prop="endpoint"
        :label="t('productResources.endpoint')"
        min-width="220"
        show-overflow-tooltip
      />
      <el-table-column
        prop="secretAlias"
        :label="t('productResources.secretAlias')"
        min-width="130"
      />
      <el-table-column :label="t('productResources.status')" width="90">
        <template #default="{ row }"
          ><el-tag :type="row.enabled ? 'success' : 'info'">{{
            row.enabled ? t('productResources.enabled') : t('productResources.disabled')
          }}</el-tag></template
        >
      </el-table-column>
      <el-table-column :label="t('productResources.actions')" width="210" fixed="right">
        <template #default="{ row }">
          <el-button link @click="edit(row)">{{ t('productResources.edit') }}</el-button>
          <el-button
            link
            :type="row.enabled ? 'warning' : 'primary'"
            :loading="submitting"
            @click="toggle(row)"
            >{{
              row.enabled ? t('productResources.disabled') : t('productResources.enabled')
            }}</el-button
          >
          <el-button link type="danger" :loading="submitting" @click="remove(row)">{{
            t('productResources.delete')
          }}</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-else :description="t('productCatalog.noAccess')" />
    <el-empty
      v-if="canManageChannels && !channels.length && !channelsLoading"
      :description="t('productResources.empty')"
    />

    <template v-if="canReadDeliveries">
      <el-divider />
      <div class="toolbar">
        <div>
          <h2>{{ t('productResources.deliveryLogs') }}</h2>
        </div>
      </div>
      <el-alert v-if="deliveryError" type="error" :title="deliveryError" :closable="false">
        <template #default
          ><el-button link @click="loadDeliveries">{{
            t('productFeedback.retry')
          }}</el-button></template
        >
      </el-alert>
      <el-table v-loading="deliveriesLoading" :data="deliveries">
        <el-table-column prop="channelId" :label="t('productResources.key')" min-width="160" />
        <el-table-column prop="status" :label="t('productResources.status')" width="110" />
        <el-table-column prop="attemptCount" :label="t('productResources.attempts')" width="80" />
        <el-table-column
          prop="error"
          :label="t('productResources.error')"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column :label="t('productResources.time')" min-width="170"
          ><template #default="{ row }">{{
            new Date(row.createTime).toLocaleString()
          }}</template></el-table-column
        >
      </el-table>
      <el-empty
        v-if="!deliveries.length && !deliveriesLoading"
        :description="t('productResources.auditEmpty')"
      />
    </template>

    <ProductApiTestCard
      v-if="canSend"
      v-model:api-key="testApiKey"
      :title="t('productResources.pushTestTitle')"
      :description="t('productResources.pushTestDescription')"
      :error="testError"
      :result="testResult"
    >
      <el-form-item :label="t('productResources.testChannels')">
        <el-select
          v-model="testForm.channelIds"
          multiple
          filterable
          allow-create
          style="width: 100%"
        >
          <el-option
            v-for="channel in channels"
            :key="channel.id"
            :label="channel.name"
            :value="channel.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('productResources.testTitle')">
        <el-input v-model="testForm.title" />
      </el-form-item>
      <el-form-item :label="t('productResources.testContent')">
        <el-input v-model="testForm.content" type="textarea" :rows="3" />
      </el-form-item>
      <template #actions>
        <el-button type="primary" :loading="testSubmitting" @click="sendTest">{{
          t('productResources.sendTestRequest')
        }}</el-button>
      </template>
    </ProductApiTestCard>

    <el-dialog
      v-model="dialog"
      :title="editing ? t('productResources.edit') : t('productResources.addChannel')"
      width="520px"
      destroy-on-close
    >
      <el-alert v-if="formError" type="error" :title="formError" :closable="false" />
      <el-form label-position="top">
        <el-form-item :label="t('productResources.name')"
          ><el-input v-model="form.name"
        /></el-form-item>
        <el-form-item v-if="!editing" :label="t('productResources.type')"
          ><el-select v-model="form.type"
            ><el-option :label="pushChannelTypeLabel('webhook')" value="webhook" /><el-option
              :label="pushChannelTypeLabel('dingtalk')"
              value="dingtalk" /><el-option
              :label="pushChannelTypeLabel('feishu')"
              value="feishu" /><el-option
              :label="pushChannelTypeLabel('wechat_work')"
              value="wechat_work" /></el-select
        ></el-form-item>
        <el-form-item :label="t('productResources.endpoint')"
          ><el-input v-model="form.endpoint"
        /></el-form-item>
        <el-form-item :label="t('productResources.secretAlias')">
          <el-select
            v-model="form.secretAlias"
            clearable
            filterable
            :loading="credentialAliasesLoading"
            :placeholder="t('productResources.pushCredentialAliasPlaceholder')"
            style="width: 100%"
          >
            <el-option
              v-for="secret in credentialAliases"
              :key="secret.alias"
              :label="secret.alias"
              :value="secret.alias"
            >
              <div class="credential-option">
                <code>{{ secret.alias }}</code>
                <span>{{
                  secret.lastUsedAt
                    ? t('productResources.lastUsed')
                    : t('productResources.neverUsed')
                }}</span>
              </div>
            </el-option>
          </el-select>
          <p class="field-hint">{{ t('productResources.pushCredentialAliasHint') }}</p>
        </el-form-item>
        <el-alert type="info" :closable="false" class="credential-explanation">
          <template #title>{{ t('productResources.pushCredentialPurposeTitle') }}</template>
          <p>{{ t('productResources.pushCredentialPurpose') }}</p>
          <p>{{ t('productResources.pushCredentialEndpointHint') }}</p>
        </el-alert>
        <div class="credential-writer">
          <div class="credential-writer__header">
            <div>
              <div class="credential-writer__title">
                {{ t('productResources.pushCredentialWriteTitle') }}
              </div>
              <div class="field-hint">{{ t('productResources.pushCredentialWriteHint') }}</div>
            </div>
            <el-button text type="primary" @click="toggleCredentialWriter">{{
              showCredentialWriter
                ? t('productResources.pushCredentialWriteCancel')
                : t('productResources.pushCredentialWriteAction')
            }}</el-button>
          </div>
          <el-collapse-transition>
            <div v-if="showCredentialWriter" class="credential-writer__form">
              <el-form-item :label="t('productResources.pushCredentialAliasName')">
                <el-input
                  v-model="credentialDraft.alias"
                  maxlength="100"
                  placeholder="PUSH_BEARER_TOKEN"
                  @input="normalizeCredentialAlias"
                />
              </el-form-item>
              <el-form-item :label="t('productResources.pushCredentialValue')">
                <el-input v-model="credentialDraft.value" type="password" show-password />
              </el-form-item>
              <el-button type="primary" :loading="credentialSaving" @click="saveCredential">{{
                t('productResources.pushCredentialWriteAction')
              }}</el-button>
            </div>
          </el-collapse-transition>
        </div>
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
import type {
  DeveloperProductInstanceDto,
  DeveloperPushChannelDto,
  DeveloperPushDeliveryDto,
  DeveloperSecretDto,
} from '@/client/types.gen'
import { Permission } from '@/constant/permission'
import { developerProductService } from '@/service/developerProductService'
import { i18ns } from '@/locales'
import { getErrorMessage } from '@/utils/error-utils'
import { pushChannelTypeLabel } from '@/views/products/developer-product-ui'
import ProductApiTestCard from '@/views/products/components/ProductApiTestCard.vue'

const { t } = i18ns
const props = defineProps<{
  instance?: DeveloperProductInstanceDto
  hasPermission: (permission: string) => boolean
}>()
const channelsLoading = ref(false)
const deliveriesLoading = ref(false)
const submitting = ref(false)
const channelError = ref('')
const deliveryError = ref('')
const formError = ref('')
const channels = ref<DeveloperPushChannelDto[]>([])
const deliveries = ref<DeveloperPushDeliveryDto[]>([])
const credentialAliases = ref<DeveloperSecretDto[]>([])
const credentialAliasesLoading = ref(false)
const credentialSaving = ref(false)
const showCredentialWriter = ref(false)
const credentialDraft = ref({ alias: '', value: '' })
const dialog = ref(false)
const editing = ref<DeveloperPushChannelDto>()
const testApiKey = ref('')
const testError = ref('')
const testResult = ref<unknown>()
const testSubmitting = ref(false)
const testForm = ref({ channelIds: [] as string[], title: '', content: '' })
const form = ref({
  name: '',
  type: 'webhook' as 'webhook' | 'dingtalk' | 'feishu' | 'wechat_work',
  endpoint: '',
  secretAlias: '',
})
let channelSequence = 0
let deliverySequence = 0
let credentialAliasesSequence = 0

const canManageChannels = computed(() =>
  props.hasPermission(Permission.PRODUCT_PUSH_CHANNEL_MANAGE),
)
const canReadDeliveries = computed(() => props.hasPermission(Permission.PRODUCT_PUSH_DELIVERY_READ))
const canSend = computed(() => props.hasPermission(Permission.PRODUCT_PUSH_SEND))

const loadChannels = async () => {
  if (!props.instance || !canManageChannels.value) {
    channels.value = []
    return
  }
  const instanceId = props.instance.id
  const sequence = ++channelSequence
  channelsLoading.value = true
  channelError.value = ''
  try {
    const nextChannels = await developerProductService.listPushChannelResources(instanceId)
    if (sequence === channelSequence && props.instance?.id === instanceId)
      channels.value = nextChannels
  } catch (cause) {
    if (sequence === channelSequence) {
      channelError.value = getErrorMessage(cause, t('productFeedback.loadFailed'))
      ElMessage.error(channelError.value)
    }
  } finally {
    if (sequence === channelSequence) channelsLoading.value = false
  }
}

const loadDeliveries = async () => {
  if (!props.instance || !canReadDeliveries.value) {
    deliveries.value = []
    return
  }
  const instanceId = props.instance.id
  const sequence = ++deliverySequence
  deliveriesLoading.value = true
  deliveryError.value = ''
  try {
    const nextDeliveries = await developerProductService.listPushDeliveryResources(instanceId)
    if (sequence === deliverySequence && props.instance?.id === instanceId)
      deliveries.value = nextDeliveries
  } catch (cause) {
    if (sequence === deliverySequence) {
      deliveryError.value = getErrorMessage(cause, t('productFeedback.loadFailed'))
      ElMessage.error(deliveryError.value)
    }
  } finally {
    if (sequence === deliverySequence) deliveriesLoading.value = false
  }
}

const load = () => Promise.all([loadChannels(), loadDeliveries()])
const loadCredentialAliases = async () => {
  if (!props.instance || !canManageChannels.value) {
    credentialAliases.value = []
    return
  }
  const instanceId = props.instance.id
  const sequence = ++credentialAliasesSequence
  credentialAliasesLoading.value = true
  try {
    const aliases = await developerProductService.listPushCredentialAliases(instanceId)
    if (sequence === credentialAliasesSequence && props.instance?.id === instanceId)
      credentialAliases.value = aliases
  } catch (cause) {
    if (sequence === credentialAliasesSequence)
      ElMessage.error(getErrorMessage(cause, t('productResources.pushCredentialLoadFailed')))
  } finally {
    if (sequence === credentialAliasesSequence) credentialAliasesLoading.value = false
  }
}
const openCreate = () => {
  editing.value = undefined
  form.value = { name: '', type: 'webhook', endpoint: '', secretAlias: '' }
  credentialDraft.value = { alias: '', value: '' }
  showCredentialWriter.value = false
  formError.value = ''
  dialog.value = true
  void loadCredentialAliases()
}
const edit = (row: DeveloperPushChannelDto) => {
  editing.value = row
  form.value = {
    name: row.name,
    type: row.type as typeof form.value.type,
    endpoint: row.endpoint,
    secretAlias: row.secretAlias || '',
  }
  credentialDraft.value = { alias: row.secretAlias || '', value: '' }
  showCredentialWriter.value = false
  formError.value = ''
  dialog.value = true
  void loadCredentialAliases()
}
const normalizeCredentialAlias = (value: string) => {
  credentialDraft.value.alias = value.toUpperCase()
}
const toggleCredentialWriter = () => {
  showCredentialWriter.value = !showCredentialWriter.value
  if (showCredentialWriter.value && !credentialDraft.value.alias)
    credentialDraft.value.alias = form.value.secretAlias || ''
}
const saveCredential = async () => {
  if (!props.instance || credentialSaving.value) return
  const alias = credentialDraft.value.alias.trim()
  if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(alias) || !credentialDraft.value.value) {
    formError.value = t('productResources.invalidSecretAlias')
    return
  }
  credentialSaving.value = true
  try {
    const saved = await developerProductService.upsertPushCredentialAlias(props.instance.id, {
      alias,
      value: credentialDraft.value.value,
    })
    credentialAliases.value = [
      saved,
      ...credentialAliases.value.filter((candidate) => candidate.alias !== saved.alias),
    ]
    form.value.secretAlias = saved.alias
    credentialDraft.value.value = ''
    showCredentialWriter.value = false
    formError.value = ''
    ElMessage.success(t('productResources.pushCredentialSaved'))
  } catch (cause) {
    formError.value = getErrorMessage(cause, t('productFeedback.operationFailed'))
    ElMessage.error(formError.value)
  } finally {
    credentialSaving.value = false
  }
}
const validForm = () => {
  if (!form.value.name.trim()) return t('required')
  if (!/^https?:\/\//i.test(form.value.endpoint.trim())) return t('productResources.invalidUrl')
  return ''
}
const save = async () => {
  if (!props.instance || submitting.value || !canManageChannels.value) return
  formError.value = validForm()
  if (formError.value) return
  submitting.value = true
  try {
    if (editing.value) {
      await developerProductService.updatePushChannelResource(props.instance.id, editing.value.id, {
        name: form.value.name.trim(),
        endpoint: form.value.endpoint.trim(),
        secretAlias: form.value.secretAlias.trim() || null,
      })
    } else {
      await developerProductService.createPushChannelResource(props.instance.id, {
        ...form.value,
        name: form.value.name.trim(),
        endpoint: form.value.endpoint.trim(),
        secretAlias: form.value.secretAlias.trim() || undefined,
      })
    }
    dialog.value = false
    formError.value = ''
    await loadChannels()
    ElMessage.success(t('updateSuccess'))
  } catch (cause) {
    formError.value = getErrorMessage(cause, t('productFeedback.operationFailed'))
    ElMessage.error(formError.value)
  } finally {
    submitting.value = false
  }
}
const toggle = async (row: DeveloperPushChannelDto) => {
  if (!props.instance || submitting.value || !canManageChannels.value) return
  submitting.value = true
  try {
    await developerProductService.updatePushChannelResource(props.instance.id, row.id, {
      enabled: !row.enabled,
    })
    await loadChannels()
    ElMessage.success(t('updateSuccess'))
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    submitting.value = false
  }
}
const remove = async (row: DeveloperPushChannelDto) => {
  if (!props.instance || submitting.value || !canManageChannels.value) return
  try {
    await ElMessageBox.confirm(`${t('delete')} ${row.name}?`, t('confirmDelete'), {
      type: 'warning',
    })
    submitting.value = true
    await developerProductService.deletePushChannelResource(props.instance.id, row.id)
    await loadChannels()
    ElMessage.success(t('deleteSuccess'))
  } catch (cause) {
    if (cause !== 'cancel')
      ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    submitting.value = false
  }
}
const sendTest = async () => {
  if (testSubmitting.value) return
  if (
    !testApiKey.value.trim() ||
    !testForm.value.channelIds.length ||
    !testForm.value.title.trim() ||
    !testForm.value.content.trim()
  ) {
    testError.value = t('productResources.invalidTestRequest')
    return
  }
  testSubmitting.value = true
  testError.value = ''
  testResult.value = undefined
  try {
    testResult.value = await developerProductService.requestProductApi(
      '/v1/products/push/send',
      testApiKey.value,
      'POST',
      {
        channelIds: testForm.value.channelIds,
        title: testForm.value.title.trim(),
        content: testForm.value.content.trim(),
        idempotencyKey: `console-test-${crypto.randomUUID()}`,
      },
    )
    await loadDeliveries()
    ElMessage.success(t('productResources.testRequestSucceeded'))
  } catch (cause) {
    testError.value = getErrorMessage(cause, t('productFeedback.operationFailed'))
    ElMessage.error(testError.value)
  } finally {
    testSubmitting.value = false
  }
}

watch(
  () => [props.instance?.id, canManageChannels.value, canReadDeliveries.value],
  () => {
    void load()
    void loadCredentialAliases()
  },
  { immediate: true },
)
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
.field-hint {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.credential-option,
.credential-writer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.credential-option span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.credential-explanation {
  margin: -2px 0 16px;
}
.credential-explanation p {
  margin: 4px 0 0;
  line-height: 1.55;
}
.credential-writer {
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 12px;
}
.credential-writer__title {
  font-size: 13px;
  font-weight: 600;
}
.credential-writer__form {
  padding-top: 12px;
}
</style>
