<template>
  <section class="probe-account-panel">
    <el-alert
      type="info"
      :closable="false"
      :title="i18ns.t('relay.probeAccountHelp')"
      class="mb-4"
    />
    <div class="account-toolbar">
      <el-input
        v-model="search"
        clearable
        :placeholder="i18ns.t('relay.channelName')"
        @input="scheduleSearch"
      />
      <el-button type="primary" @click="editor.create">{{
        i18ns.t('relay.probeAccountAdd')
      }}</el-button>
    </div>
    <el-table :data="items" v-loading="loading" row-key="id">
      <el-table-column prop="name" :label="i18ns.t('relay.channelName')" min-width="170" />
      <el-table-column :label="i18ns.t('relay.probeAccountSession')" width="130">
        <template #default="{ row }"
          ><el-tag :type="row.cached ? 'success' : 'info'">{{
            row.cached ? i18ns.t('yes') : i18ns.t('no')
          }}</el-tag></template
        >
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.probeAccountNextLogin')" min-width="180">
        <template #default="{ row }">{{
          row.nextLoginAt ? new Date(row.nextLoginAt).toLocaleString() : '—'
        }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('actions')" min-width="230">
        <template #default="{ row }">
          <el-button link type="primary" @click="editor.edit(row.id)">{{
            i18ns.t('edit')
          }}</el-button>
          <el-button link type="primary" :disabled="busyId === row.id" @click="refresh(row.id)">{{
            i18ns.t('relay.probeAccountRefresh')
          }}</el-button>
          <el-button link type="danger" :disabled="busyId === row.id" @click="remove(row.id)">{{
            i18ns.t('delete')
          }}</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="[20, 50, 100]"
      layout="total, prev, pager, next, sizes"
      @current-change="load"
      @size-change="changeSize"
    />
    <el-dialog
      v-model="editorOpen"
      :title="editingId ? i18ns.t('edit') : i18ns.t('relay.probeAccountAdd')"
      width="min(820px, 96vw)"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="!saving"
      @closed="editor.close"
    >
      <div v-loading="editorLoading">
        <el-alert
          v-if="editingId"
          type="info"
          :closable="false"
          :title="i18ns.t('relay.probeAccountRetainHelp')"
          class="mb-4"
        />
        <el-form label-position="top" :disabled="editorLoading || saving">
          <el-form-item :label="i18ns.t('relay.channelName')"
            ><el-input v-model.trim="form.name" maxlength="100"
          /></el-form-item>
          <div class="account-section-heading">
            <span>1 · {{ i18ns.t('relay.probeAccountConnection') }}</span
            ><el-button link @click="editor.applyNewApiPreset">New API 0.12+</el-button
            ><el-button link @click="editor.applyPasswordPreset">{{
              i18ns.t('relay.probeAccountPasswordPreset')
            }}</el-button>
          </div>
          <template v-if="editor.newApiPreset.value">
            <el-alert
              type="info"
              :closable="false"
              :title="i18ns.t('relay.probeNewApiPresetHelp')"
              class="mb-3"
            />
            <el-form-item :label="i18ns.t('relay.probePanelOrigin')" required
              ><el-input
                v-model.trim="editor.panelOrigin.value"
                placeholder="https://panel.example.com"
            /></el-form-item>
          </template>
          <div class="account-connection">
            <el-form-item :label="i18ns.t('relay.probeAccountMethod')"
              ><el-select v-model="form.method"
                ><el-option value="POST" label="POST" /><el-option
                  value="GET"
                  label="GET" /></el-select
            ></el-form-item>
            <el-form-item :label="i18ns.t('relay.probeAccountUrl')"
              ><el-input
                v-model.trim="form.url"
                :placeholder="
                  editor.isSaved(['url'])
                    ? i18ns.t('relay.probeAccountSavedValue')
                    : 'https://example.com/login'
                "
            /></el-form-item>
          </div>
          <el-form-item :label="i18ns.t('relay.probeAccountBody')">
            <ProbeKeyValueEditor
              v-model="form.body"
              value-mode="json"
              :saved-keys="editor.savedKeys('body')"
              :empty-text="i18ns.t('relay.probeAccountNoFields')"
              :key-placeholder="i18ns.t('relay.channelProbeCredentialName')"
              :value-placeholder="i18ns.t('relay.channelProbeCredentialValue')"
            />
          </el-form-item>
          <el-collapse>
            <el-collapse-item :title="i18ns.t('relay.probeAccountRequestAdvanced')" name="request">
              <el-form-item :label="i18ns.t('relay.probeAccountHeaders')"
                ><ProbeKeyValueEditor
                  v-model="form.headers"
                  :saved-keys="editor.savedKeys('headers')"
                  :empty-text="i18ns.t('relay.probeAccountNoFields')"
                  key-placeholder="Authorization"
                  value-placeholder="Bearer {{panelToken}}"
              /></el-form-item>
              <el-form-item :label="i18ns.t('relay.probeAccountQuery')"
                ><ProbeKeyValueEditor
                  v-model="form.query"
                  :saved-keys="editor.savedKeys('query')"
                  :empty-text="i18ns.t('relay.probeAccountNoFields')"
                  :key-placeholder="i18ns.t('relay.channelProbeCredentialName')"
                  :value-placeholder="i18ns.t('relay.channelProbeCredentialValue')"
              /></el-form-item>
            </el-collapse-item>
          </el-collapse>
          <div class="account-section-heading">
            2 · {{ i18ns.t('relay.channelProbeCredentials') }}
          </div>
          <el-alert
            type="info"
            :closable="false"
            :title="i18ns.t('relay.probeAccountCredentialHelp')"
            class="mb-3"
          />
          <el-empty
            v-if="!credentialNames.length"
            :description="i18ns.t('relay.probeAccountNoVariables')"
            :image-size="52"
          />
          <div class="account-grid">
            <el-form-item
              v-for="name in credentialNames"
              :key="name"
              :label="name"
              :required="!savedCredentialNames.includes(name)"
            >
              <el-input
                v-model="credentials[name]"
                type="password"
                show-password
                autocomplete="new-password"
                :placeholder="
                  savedCredentialNames.includes(name)
                    ? i18ns.t('relay.probeAccountSavedValue')
                    : i18ns.t('relay.channelProbeCredentialValue')
                "
              />
            </el-form-item>
          </div>
          <div class="account-section-heading">
            3 · {{ i18ns.t('relay.probeAccountSessionSettings') }}
          </div>
          <div class="account-grid">
            <el-form-item
              :label="i18ns.t('relay.probeAccountTokenPath')"
              :required="!form.tokenField"
              ><el-input
                v-model.trim="form.tokenPath"
                placeholder="data.token"
                :disabled="Boolean(form.tokenField)"
            /></el-form-item>
            <el-form-item :label="i18ns.t('relay.probeAccountFallbackTtl')"
              ><el-input-number v-model="form.fallbackTtlSeconds" :min="60" :max="86400"
            /></el-form-item>
          </div>
          <el-collapse>
            <el-collapse-item :title="i18ns.t('relay.probeSessionFields')" name="fields">
              <el-alert
                type="info"
                :closable="false"
                :title="i18ns.t('relay.probeSessionFieldsHelp')"
                class="mb-3"
              />
              <el-form-item :label="i18ns.t('relay.probeSessionFields')"
                ><ProbePanelSessionFields v-model="form.sessionFields"
              /></el-form-item>
              <el-form-item :label="i18ns.t('relay.probeSessionTokenField')">
                <el-select
                  v-model="form.tokenField"
                  clearable
                  :placeholder="i18ns.t('relay.probeAccountTokenPath')"
                  ><el-option
                    v-for="field in form.sessionFields.filter((field) => field.name)"
                    :key="field.name"
                    :value="field.name"
                    :label="field.name"
                /></el-select>
              </el-form-item>
              <el-form-item :label="i18ns.t('relay.probeSessionAllowedOrigins')"
                ><el-select
                  v-model="form.allowedOrigins"
                  multiple
                  filterable
                  allow-create
                  default-first-option
              /></el-form-item>
            </el-collapse-item>
            <el-collapse-item :title="i18ns.t('relay.probeSessionRefresh')" name="refresh">
              <el-switch
                v-model="form.refreshEnabled"
                :active-text="i18ns.t('relay.probeSessionRefreshEnabled')"
              />
              <template v-if="form.refreshEnabled">
                <div class="account-connection mt-3">
                  <el-form-item :label="i18ns.t('relay.probeAccountMethod')"
                    ><el-select v-model="form.refreshMethod"
                      ><el-option value="POST" label="POST" /><el-option
                        value="GET"
                        label="GET" /></el-select
                  ></el-form-item>
                  <el-form-item :label="i18ns.t('relay.probeSessionRefreshUrl')"
                    ><el-input
                      v-model.trim="form.refreshUrl"
                      :placeholder="
                        editor.refreshUrlSaved.value
                          ? i18ns.t('relay.probeAccountSavedValue')
                          : 'https://example.com/refresh'
                      "
                  /></el-form-item>
                </div>
                <el-form-item :label="i18ns.t('relay.probeAccountHeaders')"
                  ><ProbeKeyValueEditor
                    v-model="form.refreshHeaders"
                    :saved-keys="editor.savedRefreshKeys('headers')"
                    :empty-text="i18ns.t('relay.probeAccountNoFields')"
                    key-placeholder="Authorization"
                    value-placeholder="Bearer {{account.accessToken}}"
                /></el-form-item>
                <el-form-item :label="i18ns.t('relay.probeAccountQuery')"
                  ><ProbeKeyValueEditor
                    v-model="form.refreshQuery"
                    :saved-keys="editor.savedRefreshKeys('query')"
                    :empty-text="i18ns.t('relay.probeAccountNoFields')"
                    :key-placeholder="i18ns.t('relay.channelProbeCredentialName')"
                    :value-placeholder="i18ns.t('relay.channelProbeCredentialValue')"
                /></el-form-item>
                <el-form-item :label="i18ns.t('relay.probeAccountBody')"
                  ><ProbeKeyValueEditor
                    v-model="form.refreshBody"
                    value-mode="json"
                    :saved-keys="editor.savedRefreshKeys('body')"
                    :empty-text="i18ns.t('relay.probeAccountNoFields')"
                    :key-placeholder="i18ns.t('relay.channelProbeCredentialName')"
                    :value-placeholder="i18ns.t('relay.channelProbeCredentialValue')"
                /></el-form-item>
                <el-form-item :label="i18ns.t('relay.probeSessionRefreshTtl')"
                  ><el-input-number v-model="form.refreshTtlSeconds" :min="60" :max="86400"
                /></el-form-item>
              </template>
            </el-collapse-item>
            <el-collapse-item :title="i18ns.t('relay.probeAccountExpiryAdvanced')" name="expiry">
              <div class="account-grid">
                <el-form-item :label="i18ns.t('relay.probeAccountExpiresPath')"
                  ><el-input v-model.trim="form.expiresPath" placeholder="data.expires_in"
                /></el-form-item>
                <el-form-item :label="i18ns.t('relay.probeAccountExpiresMode')"
                  ><el-select v-model="form.expiresMode" clearable
                    ><el-option
                      value="seconds"
                      :label="i18ns.t('relay.probeAccountSeconds')" /><el-option
                      value="iso"
                      label="ISO 8601" /><el-option
                      value="unixSeconds"
                      :label="i18ns.t('relay.probeSessionUnixSeconds')" /><el-option
                      value="unixMillis"
                      :label="i18ns.t('relay.probeSessionUnixMillis')" /></el-select
                ></el-form-item>
                <el-form-item :label="i18ns.t('relay.probeAccountLoginInterval')"
                  ><el-input-number v-model="form.minLoginIntervalSeconds" :min="1" :max="86400"
                /></el-form-item>
              </div>
            </el-collapse-item>
          </el-collapse>
        </el-form>
      </div>
      <template #footer
        ><el-button :disabled="saving" @click="editorOpen = false">{{
          i18ns.t('cancel')
        }}</el-button
        ><el-button
          type="primary"
          :loading="saving"
          :disabled="editorLoading"
          @click="editor.save"
          >{{ i18ns.t('confirm') }}</el-button
        ></template
      >
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import type { RelayChannelProbeAccountDto } from '@/client/types.gen'
import { i18ns } from '@/locales'
import { relayChannelProbeService } from '@/service/relayChannelProbeService'
import { ElMessageBox } from '@/utils/elementPlusRuntime'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import ProbeKeyValueEditor from '../../components/ProbeKeyValueEditor.vue'
import { useProbeAccountEditor } from '../useProbeAccountEditor'
import ProbePanelSessionFields from './ProbePanelSessionFields.vue'

const items = ref<RelayChannelProbeAccountDto[]>([])
const loading = ref(false),
  page = ref(1),
  pageSize = ref(20),
  total = ref(0),
  search = ref(''),
  busyId = ref<string>()
let sequence = 0,
  timer: ReturnType<typeof setTimeout> | undefined
async function load() {
  const current = ++sequence
  loading.value = true
  try {
    const result = await relayChannelProbeService.listAccountPage(
      page.value,
      pageSize.value,
      search.value || undefined,
    )
    if (current !== sequence) return
    items.value = result.items
    total.value = result.total
    if (page.value > 1 && !result.items.length) {
      page.value--
      await load()
    }
  } catch (error) {
    if (current === sequence) showRequestErrorNotice(error, i18ns.t('operationFailed'))
  } finally {
    if (current === sequence) loading.value = false
  }
}
function scheduleSearch() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    page.value = 1
    void load()
  }, 300)
}
function changeSize() {
  page.value = 1
  void load()
}
const editor = useProbeAccountEditor(load)
const {
  form,
  open: editorOpen,
  loading: editorLoading,
  saving,
  editingId,
  credentials,
  credentialNames,
  savedCredentialNames,
} = editor
async function refresh(id: string) {
  busyId.value = id
  try {
    await ElMessageBox.confirm(i18ns.t('relay.probeAccountRefreshConfirm'), i18ns.t('warning'))
    await relayChannelProbeService.refreshAccount(id)
    await load()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close')
      showRequestErrorNotice(error, i18ns.t('operationFailed'))
  } finally {
    busyId.value = undefined
  }
}
async function remove(id: string) {
  busyId.value = id
  try {
    await ElMessageBox.confirm(i18ns.t('relay.probeAccountDeleteConfirm'), i18ns.t('warning'))
    await relayChannelProbeService.deleteAccount(id)
    await load()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close')
      showRequestErrorNotice(error, i18ns.t('operationFailed'))
  } finally {
    busyId.value = undefined
  }
}
onMounted(() => void load())
onBeforeUnmount(() => {
  sequence++
  clearTimeout(timer)
})
</script>

<style scoped>
.account-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.account-toolbar .el-input {
  max-width: 320px;
}
.el-pagination {
  margin-top: 18px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.account-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 16px;
  margin: 8px 0 16px;
  border-top: 1px solid var(--el-border-color-lighter);
  font-weight: 600;
}
.account-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.account-connection {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 16px;
}
.probe-key-value-editor {
  width: 100%;
}
@media (max-width: 600px) {
  .account-grid {
    grid-template-columns: 1fr;
  }
  .account-toolbar {
    flex-wrap: wrap;
  }
}
</style>
