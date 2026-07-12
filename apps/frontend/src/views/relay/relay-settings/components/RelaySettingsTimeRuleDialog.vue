<template>
  <el-dialog
    v-model="timeRuleDialogVisible"
    :title="
      editingTimeRuleIndex >= 0 ? i18ns.t('relay.timeRuleEdit') : i18ns.t('relay.timeRuleAdd')
    "
    width="450px"
    append-to-body
    :close-on-click-modal="false"
  >
    <el-form
      ref="timeRuleFormRef"
      :model="timeRuleForm"
      :rules="timeRuleFormRules"
      label-width="100px"
      label-position="top"
    >
      <el-form-item :label="i18ns.t('relay.timeRuleName')" prop="name">
        <el-input v-model="timeRuleForm.name" />
      </el-form-item>
      <el-form-item :label="i18ns.t('relay.timeRuleDays')" prop="dayOfWeek">
        <el-checkbox-group v-model="timeRuleDays">
          <el-checkbox v-for="day in timeRuleDayOptions" :key="day.value" :label="day.value" border>
            {{ day.label }}
          </el-checkbox>
        </el-checkbox-group>
        <div class="form-help">
          <el-button size="small" @click="timeRuleDays = [1, 2, 3, 4, 5, 6, 7]">
            {{ i18ns.t('relay.timeRuleSelectAll') }}
          </el-button>
          <el-button size="small" @click="timeRuleDays = []">
            {{ i18ns.t('relay.timeRuleClear') }}
          </el-button>
        </div>
      </el-form-item>
      <el-form-item :label="i18ns.t('relay.timeRuleTimeRange')" prop="timeRange">
        <el-time-picker
          v-model="timeRuleRange"
          is-range
          range-separator="-"
          format="HH:mm"
          value-format="HH:mm"
          start-placeholder="Start"
          end-placeholder="End"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('relay.timeRuleMultiplier')" prop="multiplier">
        <el-input-number
          v-model="timeRuleForm.multiplier"
          :min="0.01"
          :max="100"
          :step="0.1"
          :precision="2"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('relay.timeRuleEnabled')">
        <el-switch v-model="timeRuleForm.enabled" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="timeRuleDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" @click="saveTimeRule">{{ i18ns.t('confirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRelaySettingsManagementContext } from '../context'

const state = useRelaySettingsManagementContext()

const {
  timeRuleDialogVisible,
  editingTimeRuleIndex,
  timeRuleFormRef,
  timeRuleForm,
  timeRuleFormRules,
  timeRuleDays,
  timeRuleDayOptions,
  timeRuleRange,
  saveTimeRule,
} = state
</script>
