<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import { useRemoteTerminalProductManagementContext } from '../context'

const state = useRemoteTerminalProductManagementContext()
const t = i18ns.t
const userOptions = computed(() => state.userOptions.value)
const templateDialogVisible = state.templateDialogVisible
const templateDialogTitle = state.templateDialogTitle
const templateFormRef = state.templateFormRef
const dialogSubmitting = state.dialogSubmitting
const submitTemplateDialog = state.submitTemplateDialog
const entitlementDialogVisible = state.entitlementDialogVisible
const entitlementDialogTitle = state.entitlementDialogTitle
const entitlementFormRef = state.entitlementFormRef
const handleUserSearch = state.handleUserSearch
const userOptionsLoading = state.userOptionsLoading
const templateOptions = computed(() => state.filterOptions.templates)
const submitEntitlementDialog = state.submitEntitlementDialog
const tokenDialogVisible = state.tokenDialogVisible
const submitRotateToken = state.submitRotateToken
const limitAdjustDialogVisible = state.limitAdjustDialogVisible
const limitAdjustFormRef = state.limitAdjustFormRef
const resettingUnbind = state.resettingUnbind
const handleResetUnbindCount = state.handleResetUnbindCount
const submitLimitAdjustDialog = state.submitLimitAdjustDialog

const closeTemplateDialog = () => {
  templateDialogVisible.value = false
}

const closeEntitlementDialog = () => {
  entitlementDialogVisible.value = false
}

const closeTokenDialog = () => {
  tokenDialogVisible.value = false
}

const closeLimitAdjustDialog = () => {
  limitAdjustDialogVisible.value = false
}
</script>

<template>
  <el-dialog
    v-model="templateDialogVisible"
    :title="templateDialogTitle"
    width="720px"
    destroy-on-close
  >
    <el-form
      ref="templateFormRef"
      :model="state.templateForm"
      :rules="state.templateFormRules"
      label-width="160px"
    >
      <el-form-item prop="name" :label="t('remoteTerminalProduct.templateName')">
        <el-input v-model="state.templateForm.name" />
      </el-form-item>
      <el-form-item :label="t('common.description')">
        <el-input v-model="state.templateForm.description" type="textarea" :rows="3" />
      </el-form-item>
      <el-form-item prop="billingUnit" :label="t('remoteTerminalProduct.billingUnit')">
        <el-radio-group v-model="state.templateForm.billingUnit">
          <el-radio-button label="day">{{
            t('remoteTerminalProduct.billingUnitDay')
          }}</el-radio-button>
          <el-radio-button label="week">{{
            t('remoteTerminalProduct.billingUnitWeek')
          }}</el-radio-button>
          <el-radio-button label="month">{{
            t('remoteTerminalProduct.billingUnitMonth')
          }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item :label="t('remoteTerminalProduct.offeredUnits')" required>
        <div class="full-width">
          <div class="template-range-row">
            <span>{{ t('remoteTerminalProduct.deviceQuota') }}</span>
            <el-input-number
              v-model="state.templateForm.devicePrice"
              :min="0"
              :precision="4"
              :step="0.1"
            />
          </div>
          <div class="template-range-row">
            <span>{{ t('remoteTerminalProduct.terminalQuota') }}</span>
            <el-input-number
              v-model="state.templateForm.terminalPrice"
              :min="0"
              :precision="4"
              :step="0.1"
            />
          </div>
        </div>
      </el-form-item>
      <el-form-item prop="currency" :label="t('remoteTerminalProduct.currency')">
        <el-input v-model="state.templateForm.currency" maxlength="8" />
      </el-form-item>
      <el-form-item :label="t('remoteTerminalProduct.minimumPurchaseUnits')">
        <el-input-number v-model="state.templateForm.minimumPurchaseUnits" :min="1" />
      </el-form-item>
      <el-form-item
        prop="maximumPurchaseUnits"
        :label="t('remoteTerminalProduct.maximumPurchaseUnits')"
      >
        <el-input-number v-model="state.templateForm.maximumPurchaseUnits" :min="1" />
      </el-form-item>
      <el-form-item :label="t('remoteTerminalProduct.purchaseLimit')">
        <div class="template-range-row">
          <el-input-number v-model="state.templateForm.purchaseLimitPerUser" :min="1" />
          <span class="template-range-separator">/</span>
          <el-input-number v-model="state.templateForm.purchaseLimitWindowDays" :min="1" />
        </div>
      </el-form-item>
      <el-form-item :label="t('remoteTerminalProduct.deviceConstraints')">
        <div class="full-width">
          <div class="template-range-row">
            <span>{{ t('remoteTerminalProduct.minDeviceCountLabel') }}</span>
            <el-input-number v-model="state.templateForm.minimumDeviceCount" :min="1" />
          </div>
          <div class="template-range-row">
            <span>{{ t('remoteTerminalProduct.maxDeviceCountLabel') }}</span>
            <el-input-number v-model="state.templateForm.maxDeviceCount" :min="1" />
          </div>
        </div>
      </el-form-item>
      <el-form-item :label="t('remoteTerminalProduct.terminalConstraints')">
        <div class="full-width">
          <div class="template-range-row">
            <span>{{ t('remoteTerminalProduct.minTerminalCountLabel') }}</span>
            <el-input-number v-model="state.templateForm.minimumTerminalCount" :min="1" />
          </div>
          <div class="template-range-row">
            <span>{{ t('remoteTerminalProduct.maxTerminalCountLabel') }}</span>
            <el-input-number v-model="state.templateForm.maxTerminalCount" :min="1" />
          </div>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="closeTemplateDialog">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="dialogSubmitting" @click="submitTemplateDialog">
        {{ t('common.confirm') }}
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="entitlementDialogVisible"
    :title="entitlementDialogTitle"
    width="720px"
    destroy-on-close
  >
    <el-form
      ref="entitlementFormRef"
      :model="state.entitlementForm"
      :rules="state.entitlementFormRules"
      label-width="160px"
    >
      <el-form-item prop="userId" :label="t('common.user')">
        <el-select
          v-model="state.entitlementForm.userId"
          class="full-width"
          filterable
          remote
          reserve-keyword
          :remote-method="handleUserSearch"
          :loading="userOptionsLoading"
        >
          <el-option
            v-for="user in userOptions"
            :key="user.id"
            :label="user.username"
            :value="user.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('remoteTerminalProduct.templateName')">
        <el-select v-model="state.entitlementForm.templateId" class="full-width" clearable>
          <el-option
            v-for="template in templateOptions"
            :key="template.id"
            :label="template.name"
            :value="template.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('remoteTerminalProduct.entitlementName')">
        <el-input v-model="state.entitlementForm.name" />
      </el-form-item>
      <el-form-item :label="t('common.description')">
        <el-input v-model="state.entitlementForm.description" type="textarea" :rows="3" />
      </el-form-item>
      <el-form-item prop="startAt" :label="t('remoteTerminalProduct.startAt')">
        <el-date-picker
          v-model="state.entitlementForm.startAt"
          class="full-width"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
        />
      </el-form-item>
      <el-form-item prop="endAt" :label="t('remoteTerminalProduct.endAt')">
        <el-date-picker
          v-model="state.entitlementForm.endAt"
          class="full-width"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
        />
      </el-form-item>
      <el-form-item :label="t('remoteTerminalProduct.quota')">
        <div class="full-width">
          <div class="template-range-row">
            <span>{{ t('remoteTerminalProduct.deviceQuota') }}</span>
            <el-input-number v-model="state.entitlementForm.deviceLimit" :min="0" />
          </div>
          <div class="template-range-row">
            <span>{{ t('remoteTerminalProduct.terminalQuota') }}</span>
            <el-input-number v-model="state.entitlementForm.terminalLimit" :min="0" />
          </div>
        </div>
      </el-form-item>
      <el-form-item :label="t('remoteTerminalProduct.maxDeviceCountLabel')">
        <el-input-number v-model="state.entitlementForm.maxDeviceCount" :min="1" />
      </el-form-item>
      <el-form-item :label="t('remoteTerminalProduct.maxTerminalCountLabel')">
        <el-input-number v-model="state.entitlementForm.maxTerminalCount" :min="1" />
      </el-form-item>
      <el-form-item :label="t('remoteTerminalProduct.note')">
        <el-input v-model="state.entitlementForm.note" type="textarea" :rows="3" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="closeEntitlementDialog">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="dialogSubmitting" @click="submitEntitlementDialog">
        {{ t('common.confirm') }}
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="tokenDialogVisible"
    :title="t('remoteTerminalProduct.rotateToken')"
    width="520px"
    destroy-on-close
  >
    <el-form :model="state.tokenForm" label-width="120px">
      <el-form-item :label="t('remoteTerminalProduct.tokenLabel')">
        <el-input v-model="state.tokenForm.label" />
      </el-form-item>
      <el-form-item :label="t('remoteTerminalProduct.expiresAt')">
        <el-date-picker
          v-model="state.tokenForm.expiresAt"
          class="full-width"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="closeTokenDialog">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="dialogSubmitting" @click="submitRotateToken">
        {{ t('common.confirm') }}
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="limitAdjustDialogVisible"
    :title="t('remoteTerminalProduct.adjustQuota')"
    width="560px"
    destroy-on-close
  >
    <div class="limit-adjust-row">
      <el-form
        ref="limitAdjustFormRef"
        :model="state.limitAdjustForm"
        label-width="150px"
        class="full-width"
      >
        <el-form-item :label="t('remoteTerminalProduct.deviceQuota')">
          <el-input-number v-model="state.limitAdjustForm.deviceLimit" :min="0" />
        </el-form-item>
        <el-form-item :label="t('remoteTerminalProduct.terminalQuota')">
          <el-input-number v-model="state.limitAdjustForm.terminalLimit" :min="0" />
        </el-form-item>
        <el-form-item :label="t('remoteTerminalProduct.maxDeviceCountLabel')">
          <el-input-number v-model="state.limitAdjustForm.maxDeviceCount" :min="1" />
        </el-form-item>
        <el-form-item :label="t('remoteTerminalProduct.maxTerminalCountLabel')">
          <el-input-number v-model="state.limitAdjustForm.maxTerminalCount" :min="1" />
        </el-form-item>
      </el-form>
    </div>
    <div class="reset-unbind-section">
      <div class="reset-unbind-info">
        <div class="reset-unbind-label">{{ t('remoteTerminalProduct.resetUnbindCount') }}</div>
        <div class="reset-unbind-desc">
          {{ t('remoteTerminalProduct.resetUnbindDescription') }}
        </div>
      </div>
      <el-button :loading="resettingUnbind" @click="handleResetUnbindCount">
        {{ t('remoteTerminalProduct.resetUnbindCount') }}
      </el-button>
    </div>
    <template #footer>
      <el-button @click="closeLimitAdjustDialog">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="dialogSubmitting" @click="submitLimitAdjustDialog">
        {{ t('common.confirm') }}
      </el-button>
    </template>
  </el-dialog>
</template>
