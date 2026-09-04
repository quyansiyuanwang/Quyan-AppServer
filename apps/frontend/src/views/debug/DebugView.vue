<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="debug-view">
      <h1>{{ i18ns.t('DebugView.title') }}</h1>

      <div class="debug-build-grid">
        <!-- Build Info -->
        <el-descriptions
        :title="i18ns.t('DebugView.frontendBuildInfo')"
        :column="2"
        border
        size="small"
      >
        <el-descriptions-item :label="i18ns.t('DebugView.version')">{{
          buildInfo.version
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.branch')">{{
          buildInfo.branch
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.commit')">
          <el-tag size="small" type="info">{{ buildInfo.commitHashShort }}</el-tag>
          <span style="margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary)">{{
            buildInfo.commitMessage
          }}</span>
        </el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.commitTime')">{{
          new Date(buildInfo.commitTime).toLocaleString()
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.buildTime')" :span="2">{{
          new Date(buildInfo.buildTime).toLocaleString()
        }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions
        :title="i18ns.t('DebugView.backendBuildInfo')"
        :column="2"
        border
        size="small"
        style="margin-top: 12px"
      >
        <el-descriptions-item :label="i18ns.t('DebugView.version')">{{
          backendBuildInfo?.version
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.branch')">{{
          backendBuildInfo?.branch
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.commit')">
          <el-tag size="small" type="info">{{ backendBuildInfo?.commitHashShort }}</el-tag>
          <span style="margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary)">{{
            backendBuildInfo?.commitMessage
          }}</span>
        </el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.commitTime')">{{
          backendBuildInfo?.commitTime
            ? new Date(backendBuildInfo.commitTime).toLocaleString()
            : i18ns.t('DebugView.unknown')
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.buildTime')" :span="2">{{
          backendBuildInfo?.buildTime
            ? new Date(backendBuildInfo.buildTime).toLocaleString()
            : i18ns.t('DebugView.unknown')
        }}</el-descriptions-item>
        </el-descriptions>
      </div>
      <el-divider />
      <section class="debug-section">
        <div class="debug-field-row"><el-input v-model="apiPoint"></el-input></div>
      </section>
      <el-divider />

      <!-- OpenAPI -->
      <section class="debug-section">
        <div class="debug-field-row"><el-input v-model="docApiPrefix"></el-input></div>
        <div class="debug-actions">
          <el-button type="primary" @click="JumpDocs">{{ i18ns.t('DebugView.openApiDocs') }}</el-button>
          <el-button type="primary" @click="JumpDocsJson">{{ i18ns.t('DebugView.openApiJson') }}</el-button>
          <el-button type="success" @click="openAprilPreview">{{ i18ns.t('DebugView.aprilPreview') }}</el-button>
          <el-button type="info" plain @click="simulateAprilArrival">{{ i18ns.t('DebugView.aprilSimulate') }}</el-button>
          <el-button type="warning" plain @click="closeAprilPreview">{{ i18ns.t('DebugView.aprilClosePreview') }}</el-button>
        </div>
      </section>
      <el-divider />

      <!-- Auth -->
      <section class="debug-section">
        <div class="debug-actions">
          <el-button type="primary" @click="testAuth">{{ i18ns.t('DebugView.testAuth') }}</el-button>
          <el-button v-if="isDevelopmentMode" type="warning" plain :loading="clearingTrustedWindow" @click="handleClearTrustedWindow">
            {{ i18ns.t('DebugView.clearTrustedWindow') }}
          </el-button>
        </div>
      </section>
      <el-divider />

      <!-- Permissions -->
      <section class="debug-section">
        <div class="debug-actions">
          <el-button type="primary" @click="loadPermissions">{{ i18ns.t('DebugView.loadPermissions') }}</el-button>
          <el-button type="primary" @click="displayPermissions">{{ i18ns.t('DebugView.displayPermissions') }}</el-button>
        </div>
      <el-descriptions
        :title="i18ns.t('DebugView.permissionsTitle')"
        v-if="perms.length > 0"
        border
      >
        <el-descriptions-item v-for="perm in perms" :key="perm">
          {{ perm }}
        </el-descriptions-item>
        <el-descriptions-item v-if="perms.length > 0"
          >{{ i18ns.t('DebugView.total') }}: {{ perms.length }}</el-descriptions-item
        >
        <el-descriptions-item v-if="perms.length > 0"
          ><el-button @click="clearPermissions">{{
            i18ns.t('DebugView.clearPermissions')
          }}</el-button></el-descriptions-item
        >
        </el-descriptions>
      </section>
      <el-divider />

      <!-- Relay Test -->
      <h3>{{ i18ns.t('DebugView.relayServiceTest') }}</h3>
      <el-form label-width="100px">
        <el-form-item :label="i18ns.t('DebugView.baseUrl')">
          <el-input v-model="relayBaseUrl" placeholder="https://api.openai.com/v1" />
        </el-form-item>
        <el-form-item :label="i18ns.t('DebugView.apiKey')">
          <el-input v-model="relayApiKey" type="password" show-password />
        </el-form-item>
        <el-form-item :label="i18ns.t('DebugView.message')">
          <el-input
            v-model="relayMessage"
            type="textarea"
            :rows="3"
            :placeholder="i18ns.t('DebugView.enterTestMessage')"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('DebugView.model')">
          <el-input v-model="relayModel" :placeholder="i18ns.t('DebugView.enterModelName')" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="testRelay" :loading="relayTesting">{{
            i18ns.t('DebugView.sendRequest')
          }}</el-button>
        </el-form-item>
        <el-form-item :label="i18ns.t('DebugView.response')" v-if="relayResponse">
          <el-input v-model="relayResponse" type="textarea" :rows="6" readonly />
        </el-form-item>
      </el-form>
      <el-divider />

      <!-- TEST -->
      <el-button type="primary" @click="test">{{ i18ns.t('DebugView.test') }}</el-button>
    </div>
  </div>
  <div v-else class="mobile-page mobile-adapter">
    <div class="debug-view">
      <h1>{{ i18ns.t('DebugView.title') }}</h1>

      <!-- Build Info -->
      <el-descriptions
        :title="i18ns.t('DebugView.frontendBuildInfo')"
        :column="2"
        border
        size="small"
      >
        <el-descriptions-item :label="i18ns.t('DebugView.version')">{{
          buildInfo.version
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.branch')">{{
          buildInfo.branch
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.commit')">
          <el-tag size="small" type="info">{{ buildInfo.commitHashShort }}</el-tag>
          <span style="margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary)">{{
            buildInfo.commitMessage
          }}</span>
        </el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.commitTime')">{{
          new Date(buildInfo.commitTime).toLocaleString()
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.buildTime')" :span="2">{{
          new Date(buildInfo.buildTime).toLocaleString()
        }}</el-descriptions-item>
      </el-descriptions>

      <el-descriptions
        :title="i18ns.t('DebugView.backendBuildInfo')"
        :column="2"
        border
        size="small"
        style="margin-top: 12px"
      >
        <el-descriptions-item :label="i18ns.t('DebugView.version')">{{
          backendBuildInfo?.version
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.branch')">{{
          backendBuildInfo?.branch
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.commit')">
          <el-tag size="small" type="info">{{ backendBuildInfo?.commitHashShort }}</el-tag>
          <span style="margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary)">{{
            backendBuildInfo?.commitMessage
          }}</span>
        </el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.commitTime')">{{
          backendBuildInfo?.commitTime
            ? new Date(backendBuildInfo.commitTime).toLocaleString()
            : i18ns.t('DebugView.unknown')
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('DebugView.buildTime')" :span="2">{{
          backendBuildInfo?.buildTime
            ? new Date(backendBuildInfo.buildTime).toLocaleString()
            : i18ns.t('DebugView.unknown')
        }}</el-descriptions-item>
      </el-descriptions>
      <el-divider />
      <el-input v-model="apiPoint"></el-input>
      <el-divider />

      <!-- OpenAPI -->
      <el-input v-model="docApiPrefix"></el-input>
      <el-button type="primary" @click="JumpDocs">{{ i18ns.t('DebugView.openApiDocs') }}</el-button>
      <el-button type="primary" @click="JumpDocsJson">{{
        i18ns.t('DebugView.openApiJson')
      }}</el-button>
      <el-button type="success" @click="openAprilPreview">{{
        i18ns.t('DebugView.aprilPreview')
      }}</el-button>
      <el-button type="info" plain @click="simulateAprilArrival">{{
        i18ns.t('DebugView.aprilSimulate')
      }}</el-button>
      <el-button type="warning" plain @click="closeAprilPreview">{{
        i18ns.t('DebugView.aprilClosePreview')
      }}</el-button>
      <el-divider />

      <!-- Auth -->
      <el-button type="primary" @click="testAuth">{{ i18ns.t('DebugView.testAuth') }}</el-button>
      <el-button
        v-if="isDevelopmentMode"
        type="warning"
        plain
        :loading="clearingTrustedWindow"
        @click="handleClearTrustedWindow"
      >
        {{ i18ns.t('DebugView.clearTrustedWindow') }}
      </el-button>
      <el-divider />

      <!-- Permissions -->
      <el-button type="primary" @click="loadPermissions">{{
        i18ns.t('DebugView.loadPermissions')
      }}</el-button>
      <el-button type="primary" @click="displayPermissions">{{
        i18ns.t('DebugView.displayPermissions')
      }}</el-button>
      <el-descriptions
        :title="i18ns.t('DebugView.permissionsTitle')"
        v-if="perms.length > 0"
        border
      >
        <el-descriptions-item v-for="perm in perms" :key="perm">
          {{ perm }}
        </el-descriptions-item>
        <el-descriptions-item v-if="perms.length > 0"
          >{{ i18ns.t('DebugView.total') }}: {{ perms.length }}</el-descriptions-item
        >
        <el-descriptions-item v-if="perms.length > 0"
          ><el-button @click="clearPermissions">{{
            i18ns.t('DebugView.clearPermissions')
          }}</el-button></el-descriptions-item
        >
      </el-descriptions>
      <el-divider />

      <!-- Relay Test -->
      <h3>{{ i18ns.t('DebugView.relayServiceTest') }}</h3>
      <el-form label-width="100px">
        <el-form-item :label="i18ns.t('DebugView.baseUrl')">
          <el-input v-model="relayBaseUrl" placeholder="https://api.openai.com/v1" />
        </el-form-item>
        <el-form-item :label="i18ns.t('DebugView.apiKey')">
          <el-input v-model="relayApiKey" type="password" show-password />
        </el-form-item>
        <el-form-item :label="i18ns.t('DebugView.message')">
          <el-input
            v-model="relayMessage"
            type="textarea"
            :rows="3"
            :placeholder="i18ns.t('DebugView.enterTestMessage')"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('DebugView.model')">
          <el-input v-model="relayModel" :placeholder="i18ns.t('DebugView.enterModelName')" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="testRelay" :loading="relayTesting">{{
            i18ns.t('DebugView.sendRequest')
          }}</el-button>
        </el-form-item>
        <el-form-item :label="i18ns.t('DebugView.response')" v-if="relayResponse">
          <el-input v-model="relayResponse" type="textarea" :rows="6" readonly />
        </el-form-item>
      </el-form>
      <el-divider />

      <!-- TEST -->
      <el-button type="primary" @click="test">{{ i18ns.t('DebugView.test') }}</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import StorageKey from '@/constant/storagekey'
import { useMobileTableCardLabels } from '@/composables/useMobileTableCardLabels'
import { usePageDevice } from '@/composables/usePageDevice'
import { swaggerDocsService } from '@/service/swaggerDocsService'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import { i18ns } from '@/locales'
import { Permission } from '@/constant/permission'
import systemService from '@/service/systemService'
import { AprilFoolsService } from '@/service/aprilFoolsService'
import { twoFactorManagementService } from '@/service/twoFactor/twoFactorManagementService'
import { redemptionCodeService } from '@/service/redemptionCodeService'

const APRIL_FEATURE_SWITCH_KEY = StorageKey.Easter.FEATURE_SWITCH
const APRIL_PREVIEW_MODE_KEY = StorageKey.Easter.PREVIEW_MODE
const APRIL_MASTER_DISABLED_KEY = StorageKey.Easter.MASTER_DISABLED
const APRIL_USER_DISMISS_KEY = StorageKey.Easter.USER_DISMISS_BY_DAY

const buildInfo = __BUILD_INFO__
const backendBuildInfo = ref<BuildInfo | null>(null)

const apiPoint = ref(import.meta.env.VITE_BACKEND_URL || '')
const docApiPrefix = ref('/docs')

const relayBaseUrl = ref('https://api.openai.com/v1')
const relayApiKey = ref('')
const relayMessage = ref('Hello, how are you?')
const relayModel = ref('gpt-3.5-turbo')
const relayTesting = ref(false)
const relayResponse = ref('')
const clearingTrustedWindow = ref(false)
const isDevelopmentMode = import.meta.env.DEV

const perms = ref<string[]>([])
const userInfoStore = useUserInfoStore()
const permissionStore = usePermissionStore()

onMounted(async () => {
  if (permissionStore.hasPermission(Permission.DEBUG_ACCESS)) {
    backendBuildInfo.value = await systemService.getBackendBuildInfo()
  }
})

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }

  return fallback
}

const openProtectedDebugUrl = async (resourceUrl: string) => {
  const previewWindow = window.open('', '_blank')

  if (previewWindow) {
    try {
      previewWindow.opener = null
    } catch {
      // Ignore browser restrictions while preserving popup navigation.
    }
  }

  try {
    const handoff = await swaggerDocsService.generateAccessLink(60)
    const targetUrl = swaggerDocsService.buildReurlUrl(resourceUrl, handoff.reurl)

    if (previewWindow && !previewWindow.closed) {
      previewWindow.location.replace(targetUrl)
      previewWindow.focus()
      return
    }

    const { assignDocument } = await import('@/service/navigationService')
    assignDocument(targetUrl)
  } catch (error) {
    previewWindow?.close()
    ElMessage.error(toErrorMessage(error, i18ns.t('apiDoc.openSwaggerDocsFailed')))
  }
}

const JumpDocs = async () => {
  await openProtectedDebugUrl(`${apiPoint.value}${docApiPrefix.value}`)
}

const JumpDocsJson = async () => {
  await openProtectedDebugUrl(`${apiPoint.value}${docApiPrefix.value}/openapi.json`)
}

const openAprilPreview = () => {
  TypedLocalStorage.setItem(APRIL_FEATURE_SWITCH_KEY, '1')
  TypedLocalStorage.setItem(APRIL_PREVIEW_MODE_KEY, '1')
  TypedLocalStorage.removeItem(APRIL_MASTER_DISABLED_KEY)
  TypedLocalStorage.removeItem(APRIL_USER_DISMISS_KEY)
  AprilFoolsService.syncLocalState()
  window.open(`${window.location.origin}/home`, '_blank')
}

const simulateAprilArrival = () => {
  TypedLocalStorage.setItem(APRIL_FEATURE_SWITCH_KEY, '1')
  TypedLocalStorage.setItem(APRIL_PREVIEW_MODE_KEY, '1')
  TypedLocalStorage.removeItem(APRIL_MASTER_DISABLED_KEY)
  TypedLocalStorage.removeItem(APRIL_USER_DISMISS_KEY)

  AprilFoolsService.syncLocalState()
  AprilFoolsService.runAutoSequence()
  ElMessage.success(i18ns.t('DebugView.aprilSimulated'))
}

const closeAprilPreview = () => {
  TypedLocalStorage.setItem(APRIL_PREVIEW_MODE_KEY, '0')
  TypedLocalStorage.setItem(APRIL_FEATURE_SWITCH_KEY, '0')
  AprilFoolsService.syncLocalState()
  ElMessage.success(i18ns.t('DebugView.aprilClosed'))
}

const testAuth = async () => {
  try {
    await userInfoStore.fetchUserInfo()
    console.log('User info:', userInfoStore.userInfo)
  } catch (err) {
    console.error('Error fetching user info:', err)
  }
}

const handleClearTrustedWindow = async () => {
  if (!isDevelopmentMode) return

  clearingTrustedWindow.value = true
  try {
    await twoFactorManagementService.clearTrustedWindow()
    ElMessage.success(i18ns.t('DebugView.clearTrustedWindowSuccess'))
  } catch (error) {
    console.error('Failed to clear trusted 2FA window:', error)
    ElMessage.error(i18ns.t('DebugView.clearTrustedWindowFailed'))
  } finally {
    clearingTrustedWindow.value = false
  }
}

const loadPermissions = async () => {
  try {
    await permissionStore.loadCurrentUserPermissions()
    console.log('Permissions loaded successfully.')
  } catch (err) {
    console.error('Error loading permissions:', err)
  }
}

const displayPermissions = async () => {
  perms.value = permissionStore.effectivePermissions
}

const clearPermissions = () => {
  permissionStore.clearCurrentUserPermissions()
  perms.value = []
}

const testRelay = async () => {
  if (!relayBaseUrl.value || !relayApiKey.value || !relayMessage.value) {
    ElMessage.error(i18ns.t('DebugView.fillAllFields'))
    return
  }

  relayTesting.value = true
  relayResponse.value = ''

  try {
    const response = await axios.post(
      `${relayBaseUrl.value}/chat/completions`,
      {
        model: relayModel.value,
        messages: [{ role: 'user', content: relayMessage.value }],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${relayApiKey.value}`,
        },
      },
    )
    relayResponse.value = JSON.stringify(response.data, null, 2)
    ElMessage.success(i18ns.t('DebugView.requestSuccessful'))
  } catch (error: any) {
    relayResponse.value = JSON.stringify(
      {
        error: error.message,
        response: error.response?.data,
      },
      null,
      2,
    )
    ElMessage.error(i18ns.t('DebugView.requestFailed'))
    console.error('Error testing relay service:', error)
  } finally {
    relayTesting.value = false
  }
}

const test = () => {
  redemptionCodeService.deleteCode('NOT-EXIST-ID')
}

const { isDesktop } = usePageDevice()

if (!isDesktop.value) {
  useMobileTableCardLabels('.mobile-adapter')
}
</script>

<style scoped>
.debug-view {
  width: 100%;
  min-width: 0;
}

@media (min-width: 769px) {
  .debug-build-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .debug-section {
    display: grid;
    gap: 12px;
    min-width: 0;
  }

  .debug-field-row {
    min-width: 0;
  }

  .debug-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
}

@media (max-width: 1100px) and (min-width: 769px) {
  .debug-build-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.mobile-adapter {
  padding: 8px 6px 16px;
  overflow-x: hidden;
}

.mobile-adapter :deep(.hide-on-mobile),
.mobile-adapter :deep(.el-table__header-wrapper),
.mobile-adapter :deep(.el-scrollbar__bar.is-horizontal),
.mobile-adapter :deep(.el-table__body colgroup),
.mobile-adapter :deep(.el-table__header colgroup) {
  display: none !important;
}

.mobile-adapter :deep(.el-form--inline) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.mobile-adapter :deep(.el-form-item) {
  margin-right: 0;
  margin-bottom: 10px;
}

.mobile-adapter :deep(.el-form-item__label) {
  float: none;
  display: block;
  text-align: left;
  padding: 0 0 6px;
}

.mobile-adapter :deep(.el-form-item__content) {
  margin-left: 0 !important;
}

.mobile-adapter :deep(.el-input),
.mobile-adapter :deep(.el-select),
.mobile-adapter :deep(.el-date-editor),
.mobile-adapter :deep(.el-input-number),
.mobile-adapter :deep(.el-textarea),
.mobile-adapter :deep(.el-button) {
  width: 100%;
}

.mobile-adapter :deep(.el-table__inner-wrapper),
.mobile-adapter :deep(.el-table__body-wrapper),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__wrap),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__view) {
  overflow-x: hidden !important;
}

.mobile-adapter :deep(.el-table__body-wrapper) {
  overflow-y: visible !important;
  padding: 4px 0 10px;
}

.mobile-adapter :deep(.el-table__body tbody) {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mobile-adapter :deep(.el-table__body tr) {
  display: block;
  width: 100% !important;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
}

.mobile-adapter :deep(.el-table__body td) {
  display: block;
  border: none !important;
  padding: 5px 0;
}

.mobile-adapter :deep(.el-table__body td::before) {
  content: attr(data-label);
  display: block;
  margin-bottom: 2px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
}

.mobile-adapter :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.mobile-adapter :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.mobile-adapter :deep(.el-drawer) {
  max-height: 92vh;
}

.mobile-adapter :deep(.el-pagination) {
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
