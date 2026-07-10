<template>
  <el-dialog
    v-model="unbindDialogVisible"
    :title="i18ns.t('remoteTerminalProduct.revokeDeviceDialogTitle')"
    width="520px"
    destroy-on-close
  >
    <div class="unbind-dialog" v-loading="unbindReminderLoading">
      <template v-if="unbindReminder">
        <div class="unbind-dialog__warning">
          {{ i18ns.t('remoteTerminalProduct.revokeDeviceDialogWarning') }}
        </div>
        <div class="unbind-dialog__line">
          {{
            i18ns.t('remoteTerminalProduct.revokeDeviceAllowance', {
              windowHours: unbindReminder.windowHours,
              remainingCount: unbindReminder.remainingCount,
            })
          }}
        </div>
        <div class="unbind-dialog__line">
          {{
            i18ns.t('remoteTerminalProduct.revokeDeviceAfterAction', {
              remainingCount: Math.max(0, unbindReminder.remainingCount - 1),
            })
          }}
        </div>
        <div class="unbind-dialog__line">
          {{
            i18ns.t('remoteTerminalProduct.revokeDeviceCooldown', {
              minutes: unbindReminder.rebindCooldownMinutes,
            })
          }}
        </div>
        <div class="unbind-dialog__line secondary-text">
          {{
            i18ns.t('remoteTerminalProduct.revokeDeviceUsedCount', {
              revokedCount: unbindReminder.revokedCount,
              maxCount: unbindReminder.maxCount,
            })
          }}
        </div>
        <el-checkbox v-model="unbindAgreementChecked">
          {{ i18ns.t('remoteTerminalProduct.revokeDeviceAgreement') }}
        </el-checkbox>
      </template>
    </div>
    <template #footer>
      <el-button @click="closeUnbindDialog">{{ i18ns.t('cancel') }}</el-button>
      <el-button
        type="danger"
        :disabled="!unbindAgreementChecked || !unbindReminder"
        :loading="Boolean(revokingDeviceId)"
        @click="confirmRevokeMyDevice"
      >
        {{ i18ns.t('remoteTerminalProduct.revokeDeviceConfirmAction') }}
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="installDialogVisible"
    :title="i18ns.t('remoteTerminalProduct.installAgentTitle')"
    width="46vw"
  >
    <el-form label-position="top">
      <el-form-item :label="i18ns.t('remoteTerminalProduct.installOs')">
        <el-radio-group v-model="installOs">
          <el-radio value="linux">Linux</el-radio>
          <el-radio value="windows">Windows</el-radio>
          <el-radio value="macos">macOS</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item :label="i18ns.t('remoteTerminalProduct.installArch')">
        <el-radio-group v-model="installArch">
          <el-radio value="x64">x64</el-radio>
          <el-radio value="arm64">arm64</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item :label="i18ns.t('remoteTerminalProduct.installVersion')">
        <el-select
          v-model="installVersion"
          filterable
          allow-create
          :placeholder="i18ns.t('remoteTerminalProduct.installVersionPlaceholder')"
          :loading="installVersionLoading"
          style="width: 100%"
        >
          <el-option v-for="v in installVersionOptions" :key="v" :label="v" :value="v" />
        </el-select>
        <div
          v-if="installVersionError"
          style="color: var(--el-color-danger); font-size: 12px; margin-top: 4px"
        >
          {{ i18ns.t('remoteTerminalProduct.installVersionFetchFailed') }}
          <el-button link size="small" @click="fetchInstallVersion">{{
            i18ns.t('refresh')
          }}</el-button>
        </div>
      </el-form-item>
      <el-form-item :label="i18ns.t('remoteTerminalProduct.installProxy')">
        <el-input
          v-model="installProxy"
          :placeholder="i18ns.t('remoteTerminalProduct.installProxyPlaceholder')"
          clearable
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item>
        <div style="display: flex; gap: 16px">
          <el-switch
            v-model="installShowProgress"
            :active-text="i18ns.t('remoteTerminalProduct.installShowProgress')"
          />
          <el-switch
            v-model="installRunBackground"
            :active-text="i18ns.t('remoteTerminalProduct.installRunBackground')"
          />
          <el-switch
            v-model="installUseStaticToken"
            :active-text="i18ns.t('remoteTerminalProduct.installUseStaticToken')"
            @change="onInstallUseStaticTokenChange"
          />
        </div>
      </el-form-item>
      <div v-loading="installVersionLoading" style="min-height: 60px">
        <div v-for="cmd in installCommands" :key="cmd.label" style="margin-bottom: 12px">
          <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 4px">
            {{ cmd.label }}
          </div>
          <div style="display: flex; gap: 8px; align-items: flex-start">
            <el-input
              type="textarea"
              :value="cmd.command"
              readonly
              :rows="cmd.command.split('\n').length + 2"
              style="flex: 1; font-family: monospace; font-size: 12px"
            />
            <el-button size="small" @click="copyCommand(cmd.command)">{{
              i18ns.t('copy')
            }}</el-button>
          </div>
        </div>
      </div>
    </el-form>
    <template #footer>
      <el-button @click="installDialogVisible = false">{{ i18ns.t('close') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useMyRemoteTerminalProductsContext } from '../context'

const {
  closeUnbindDialog,
  confirmRevokeMyDevice,
  copyCommand,
  fetchInstallVersion,
  installArch,
  installCommands,
  installDialogVisible,
  installOs,
  installProxy,
  installRunBackground,
  installShowProgress,
  installUseStaticToken,
  installVersion,
  installVersionError,
  installVersionLoading,
  installVersionOptions,
  onInstallUseStaticTokenChange,
  revokingDeviceId,
  unbindAgreementChecked,
  unbindDialogVisible,
  unbindReminder,
  unbindReminderLoading,
} = useMyRemoteTerminalProductsContext()
</script>
