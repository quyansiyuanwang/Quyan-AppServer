<script setup lang="ts">
import { useNotificationSettingsContext } from '../context'

const state = useNotificationSettingsContext()
const i18ns = state.i18ns
const webhookDialogVisible = state.webhookDialogVisible
const editingWebhook = state.editingWebhook
const webhookForm = state.webhookForm
const webhookFormats = state.webhookFormats
const testingWebhook = state.testingWebhook
const testResultIcon = state.testResultIcon
const handleTestWebhookInDialog = state.handleTestWebhookInDialog
const testResult = state.testResult
const testResultError = state.testResultError
const closeWebhookDialog = state.closeWebhookDialog
const savingWebhook = state.savingWebhook
const submitWebhookDialog = state.submitWebhookDialog
</script>

<template>
  <el-dialog
    v-model="webhookDialogVisible"
    :title="editingWebhook ? i18ns.t('NotificationSettingsView.webhookEdit') : i18ns.t('NotificationSettingsView.webhookAdd')"
    width="520px"
    :close-on-click-modal="false"
  >
    <el-form :model="webhookForm" label-width="120px">
      <el-form-item :label="i18ns.t('NotificationSettingsView.webhookName')" required>
        <el-input
          v-model="webhookForm.name"
          :placeholder="i18ns.t('NotificationSettingsView.webhookNamePlaceholder')"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('NotificationSettingsView.webhookUrl')" required>
        <el-input
          v-model="webhookForm.url"
          :placeholder="i18ns.t('NotificationSettingsView.webhookUrlPlaceholder')"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('NotificationSettingsView.webhookFormat')">
        <el-select v-model="webhookForm.format" style="width: 100%">
          <el-option
            v-for="fmt in webhookFormats"
            :key="fmt.value"
            :label="fmt.label"
            :value="fmt.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="i18ns.t('NotificationSettingsView.webhookSecret')">
        <el-input
          v-model="webhookForm.secret"
          :placeholder="i18ns.t('NotificationSettingsView.webhookSecretPlaceholder')"
          show-password
          clearable
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('NotificationSettingsView.webhookEnabled')">
        <el-switch v-model="webhookForm.enabled" />
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="dialog-footer">
        <div class="dialog-footer-left">
          <el-button
            v-if="editingWebhook"
            :loading="testingWebhook"
            :icon="testResultIcon"
            @click="handleTestWebhookInDialog"
          >
            {{ i18ns.t('NotificationSettingsView.webhookTest') }}
          </el-button>
          <span v-if="testResult !== null" :class="testResult ? 'test-ok' : 'test-fail'">
            {{
              testResult
                ? i18ns.t('NotificationSettingsView.webhookTestSuccess')
                : testResultError || i18ns.t('NotificationSettingsView.webhookTestFailed')
            }}
          </span>
        </div>
        <div class="dialog-footer-right">
          <el-button @click="closeWebhookDialog">
            {{ i18ns.t('NotificationSettingsView.webhookCancel') }}
          </el-button>
          <el-button type="primary" :loading="savingWebhook" @click="submitWebhookDialog">
            {{ i18ns.t('NotificationSettingsView.webhookSave') }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>
