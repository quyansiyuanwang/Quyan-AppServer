<template>
  <section class="probe-account-panel">
    <el-alert
      type="warning"
      :closable="false"
      :title="i18ns.t('relay.probeAccountHelp')"
      class="mb-4"
    />
    <div class="flex justify-between mb-3">
      <strong>{{ i18ns.t('relay.probeAccounts') }}</strong>
      <el-button type="primary" @click="openCreate">{{
        i18ns.t('relay.probeAccountAdd')
      }}</el-button>
    </div>
    <el-table :data="accounts" v-loading="loading" class="w-full" row-key="id">
      <el-table-column prop="name" :label="i18ns.t('relay.channelName')" min-width="170" />
      <el-table-column :label="i18ns.t('relay.probeAccountSession')" width="170">
        <template #default="{ row }">
          <el-tag :type="row.cached ? 'success' : 'warning'">{{
            row.cached ? i18ns.t('yes') : i18ns.t('no')
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.probeAccountNextLogin')" min-width="180">
        <template #default="{ row }">{{
          row.nextLoginAt ? new Date(row.nextLoginAt).toLocaleString() : '-'
        }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('actions')" min-width="230">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">{{ i18ns.t('edit') }}</el-button>
          <el-button link type="primary" @click="refresh(row.id)">{{
            i18ns.t('relay.probeAccountRefresh')
          }}</el-button>
          <el-button link type="danger" @click="remove(row.id)">{{ i18ns.t('delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-dialog
      v-model="dialogOpen"
      :title="i18ns.t('relay.probeAccountAdd')"
      width="min(760px, 95vw)"
      append-to-body
      :close-on-click-modal="false"
    >
      <el-alert
        v-if="editingId"
        type="info"
        :closable="false"
        :title="i18ns.t('relay.probeAccountReenterWorkflow')"
        class="mb-3"
      />
      <el-form label-position="top">
        <el-form-item :label="i18ns.t('relay.channelName')"
          ><el-input v-model.trim="form.name" maxlength="100"
        /></el-form-item>
        <el-form-item :label="i18ns.t('relay.probeAccountMethod')">
          <el-select v-model="form.method"
            ><el-option value="POST" label="POST" /><el-option value="GET" label="GET"
          /></el-select>
        </el-form-item>
        <el-form-item :label="i18ns.t('relay.probeAccountUrl')"
          ><el-input v-model.trim="form.url" placeholder="https://example.com/login"
        /></el-form-item>
        <el-form-item :label="i18ns.t('relay.probeAccountHeaders')"
          ><el-input
            v-model="form.headers"
            type="textarea"
            :rows="2"
            placeholder='{"Authorization":"Bearer {{apiKey}}"}'
        /></el-form-item>
        <el-form-item :label="i18ns.t('relay.probeAccountQuery')"
          ><el-input v-model="form.query" type="textarea" :rows="2" placeholder="{}"
        /></el-form-item>
        <el-form-item :label="i18ns.t('relay.probeAccountBody')"
          ><el-input
            v-model="form.body"
            type="textarea"
            :rows="3"
            placeholder='{"username":"{{username}}","password":"{{password}}"}'
        /></el-form-item>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
          <el-form-item :label="i18ns.t('relay.probeAccountTokenPath')"
            ><el-input v-model.trim="form.tokenPath" placeholder="data.token"
          /></el-form-item>
          <el-form-item :label="i18ns.t('relay.probeAccountExpiresPath')"
            ><el-input v-model.trim="form.expiresPath" placeholder="data.expires_in"
          /></el-form-item>
          <el-form-item :label="i18ns.t('relay.probeAccountExpiresMode')">
            <el-select v-model="form.expiresMode" clearable
              ><el-option value="seconds" :label="i18ns.t('relay.probeAccountSeconds')" /><el-option
                value="iso"
                label="ISO 8601"
            /></el-select>
          </el-form-item>
          <el-form-item :label="i18ns.t('relay.probeAccountFallbackTtl')"
            ><el-input-number v-model="form.fallbackTtlSeconds" :min="60" :max="86400"
          /></el-form-item>
          <el-form-item :label="i18ns.t('relay.probeAccountLoginInterval')"
            ><el-input-number v-model="form.minLoginIntervalSeconds" :min="1" :max="86400"
          /></el-form-item>
        </div>
        <el-form-item :label="i18ns.t('relay.channelProbeCredentials')">
          <div class="w-full">
            <div v-for="(credential, index) in credentials" :key="index" class="flex gap-2 mb-2">
              <el-input
                v-model.trim="credential.name"
                :placeholder="i18ns.t('relay.channelProbeCredentialName')"
              />
              <el-input
                v-model="credential.value"
                type="password"
                show-password
                :placeholder="i18ns.t('relay.channelProbeCredentialValue')"
              />
              <el-button @click="credentials.splice(index, 1)">×</el-button>
            </div>
            <el-button link type="primary" @click="credentials.push({ name: '', value: '' })">{{
              i18ns.t('relay.channelProbeAddCredential')
            }}</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer
        ><el-button @click="dialogOpen = false">{{ i18ns.t('cancel') }}</el-button
        ><el-button type="primary" :loading="saving" @click="save">{{
          i18ns.t('confirm')
        }}</el-button></template
      >
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type {
  RelayChannelProbeAccountDto,
  SaveRelayChannelProbeAccountRequest,
} from '@/client/types.gen'
import { i18ns } from '@/locales'
import { relayChannelProbeService } from '@/service/relayChannelProbeService'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusRuntime'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { useRelayChannelProbeManagementContext } from '../context'

const { accounts, loadAccounts } = useRelayChannelProbeManagementContext()
const loading = ref(false)
const saving = ref(false)
const dialogOpen = ref(false)
const editingId = ref<string>()
const credentials = ref<Array<{ name: string; value: string }>>([])
const blank = () => ({
  name: '',
  method: 'POST' as 'POST' | 'GET',
  url: '',
  headers: '{}',
  query: '{}',
  body: '{}',
  tokenPath: '',
  expiresPath: '',
  expiresMode: '' as '' | 'seconds' | 'iso',
  fallbackTtlSeconds: 1800,
  minLoginIntervalSeconds: 300,
})
const form = reactive(blank())
async function load() {
  loading.value = true
  try {
    await loadAccounts()
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('operationFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(() => void load())
function openCreate() {
  Object.assign(form, blank())
  credentials.value = []
  editingId.value = undefined
  dialogOpen.value = true
}
function openEdit(account: RelayChannelProbeAccountDto) {
  Object.assign(form, blank(), {
    name: account.name,
    tokenPath: account.tokenPath,
    expiresPath: account.expiresPath ?? '',
    expiresMode: account.expiresMode ?? '',
    fallbackTtlSeconds: account.fallbackTtlSeconds,
    minLoginIntervalSeconds: account.minLoginIntervalSeconds,
  })
  credentials.value = []
  editingId.value = account.id
  dialogOpen.value = true
}
function parseObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(i18ns.t('relay.probeAccountInvalidJson'))
  return parsed as Record<string, unknown>
}
async function save() {
  saving.value = true
  try {
    const map = Object.fromEntries(
      credentials.value
        .filter((item) => item.name && item.value)
        .map((item) => [item.name, item.value]),
    )
    if (credentials.value.some((item) => !item.name || !item.value))
      throw new Error(i18ns.t('relay.channelProbeCredentialIncomplete'))
    const body: SaveRelayChannelProbeAccountRequest = {
      name: form.name,
      loginWorkflow: {
        method: form.method,
        url: form.url,
        headers: parseObject(form.headers) as Record<string, string>,
        query: parseObject(form.query) as Record<string, string>,
        body: parseObject(form.body),
      },
      tokenPath: form.tokenPath,
      expiresPath: form.expiresPath || undefined,
      expiresMode: form.expiresMode || undefined,
      fallbackTtlSeconds: form.fallbackTtlSeconds,
      minLoginIntervalSeconds: form.minLoginIntervalSeconds,
      ...(Object.keys(map).length ? { credentials: map } : {}),
    }
    if (editingId.value) await relayChannelProbeService.updateAccount(editingId.value, body)
    else await relayChannelProbeService.createAccount(body)
    credentials.value = []
    dialogOpen.value = false
    await load()
    ElMessage.success(i18ns.t('success'))
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('operationFailed'))
  } finally {
    saving.value = false
  }
}
async function refresh(id: string) {
  try {
    await ElMessageBox.confirm(i18ns.t('relay.probeAccountRefreshConfirm'), i18ns.t('warning'))
    await relayChannelProbeService.refreshAccount(id)
    await load()
  } catch (error) {
    if (error !== 'cancel') showRequestErrorNotice(error, i18ns.t('operationFailed'))
  }
}
async function remove(id: string) {
  try {
    await ElMessageBox.confirm(i18ns.t('relay.probeAccountDeleteConfirm'), i18ns.t('warning'))
    await relayChannelProbeService.deleteAccount(id)
    await load()
  } catch (error) {
    if (error !== 'cancel') showRequestErrorNotice(error, i18ns.t('operationFailed'))
  }
}
</script>
