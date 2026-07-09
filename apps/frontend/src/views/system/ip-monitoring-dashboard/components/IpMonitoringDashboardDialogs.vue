<template>
  <el-dialog
    v-model="wlDialogVisible"
    :title="i18ns.t('ipWhitelist.addTitle')"
    width="480px"
    :close-on-click-modal="false"
    @closed="handleWhitelistClosed"
  >
    <el-form ref="wlFormRef" :model="wlForm" :rules="wlFormRules" label-width="90px">
      <el-form-item :label="i18ns.t('ipWhitelist.ipAddress')" prop="ipAddress">
        <el-input v-model="wlForm.ipAddress" :placeholder="i18ns.t('ipWhitelist.ipPlaceholder')" />
      </el-form-item>
      <el-form-item :label="i18ns.t('ipWhitelist.reason')">
        <el-input
          v-model="wlForm.reason"
          :placeholder="i18ns.t('ipWhitelist.reasonPlaceholder')"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('ipWhitelist.expiresAt')">
        <el-date-picker
          v-model="wlForm.expiresAt"
          type="datetime"
          :placeholder="i18ns.t('ipWhitelist.expiresAtPlaceholder')"
          style="width: 100%"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="wlDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="wlSubmitting" @click="handleWlSubmit">
          {{ i18ns.t('confirm') }}
        </el-button>
      </span>
    </template>
  </el-dialog>

  <el-dialog
    v-model="dialogVisible"
    :title="isEdit ? i18ns.t('ipBlacklist.editTitle') : i18ns.t('ipBlacklist.createTitle')"
    width="500px"
    :close-on-click-modal="false"
    @closed="resetForm"
  >
    <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
      <el-form-item v-if="!isEdit" :label="i18ns.t('ipBlacklist.ipAddress')" prop="ipAddress">
        <el-input
          v-model="formData.ipAddress"
          :placeholder="i18ns.t('ipBlacklist.ipPlaceholder')"
        />
      </el-form-item>
      <el-form-item v-if="!isEdit" :label="i18ns.t('ipBlacklist.duration')" prop="duration">
        <el-select v-model="formData.duration" style="width: 100%">
          <el-option :label="i18ns.t('ipBlacklist.duration1Hour')" :value="3600" />
          <el-option :label="i18ns.t('ipBlacklist.duration24Hours')" :value="86400" />
          <el-option :label="i18ns.t('ipBlacklist.duration7Days')" :value="604800" />
          <el-option :label="i18ns.t('ipBlacklist.durationPermanent')" :value="-1" />
        </el-select>
      </el-form-item>
      <el-form-item :label="i18ns.t('ipBlacklist.reason')" prop="banReason">
        <el-input
          v-model="formData.banReason"
          type="textarea"
          :rows="4"
          :placeholder="i18ns.t('ipBlacklist.reasonPlaceholder')"
        />
      </el-form-item>
      <el-form-item v-if="isEdit" :label="i18ns.t('ipBlacklist.expireTime')" prop="expireTime">
        <el-date-picker
          v-model="formData.expireTime"
          type="datetime"
          :placeholder="i18ns.t('ipBlacklist.selectExpireTime')"
          style="width: 100%"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="dialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ i18ns.t('confirm') }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useIpMonitoringDashboardContext } from '../context'

const state = useIpMonitoringDashboardContext()

const {
  dialogVisible,
  formData,
  formRef,
  formRules,
  handleSubmit,
  handleWlSubmit,
  isEdit,
  resetForm,
  submitting,
  wlDialogVisible,
  wlForm,
  wlFormRef,
  wlFormRules,
  wlSubmitting,
} = state

const handleWhitelistClosed = () => {
  wlForm.ipAddress = ''
  wlForm.reason = ''
  wlForm.expiresAt = null
  wlFormRef.value?.resetFields()
}
</script>
