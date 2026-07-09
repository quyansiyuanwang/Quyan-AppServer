<template>
  <div class="sm-mobile">
    <div class="sm-mobile-head">
      <span class="sm-logo-row">
        <span class="sm-logo-icon">&#x276F;_</span>
        <span class="sm-logo-text">{{ i18ns.t('scriptManager.title') }}</span>
      </span>
      <PermissionWrapper :require="[Permission.SCRIPT_CREATE]">
        <button class="sm-btn sm-btn-primary" @click="emit('create')">
          + {{ i18ns.t('scriptManager.create') }}
        </button>
      </PermissionWrapper>
    </div>

    <UserScriptSecurityNotice
      :model-value="runSafetyConfirmed"
      :items="securityNoticeItems"
      @update:model-value="emit('update:runSafetyConfirmed', $event)"
    />

    <div class="sm-mobile-list">
      <div v-for="script in scriptList" :key="script.id" class="sm-mobile-card">
        <div class="sm-mobile-card-name">{{ script.name }}</div>
        <div v-if="script.description" class="sm-mobile-card-desc">{{ script.description }}</div>
        <div v-if="hasNetworkRisk(script)" class="sm-mobile-card-risk">
          ⚠ {{ i18ns.tf('scriptManager.networkRiskDetail', { apis: getDetectedApisText(script) }) }}
        </div>
        <div class="sm-mobile-card-actions">
          <button class="sm-btn sm-btn-run" :disabled="!runSafetyConfirmed" @click="emit('runSingle', script)">
            ▶ {{ i18ns.t('scriptManager.run') }}
          </button>
          <button class="sm-btn sm-btn-ghost" @click="emit('history', script)">
            {{ i18ns.t('scriptManager.history') }}
          </button>
          <PermissionWrapper :require="[Permission.SCRIPT_CREATE]" mode="disabled">
            <button class="sm-btn sm-btn-ghost" @click="emit('edit', script)">
              {{ i18ns.t('edit') }}
            </button>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.SCRIPT_DELETE]" mode="disabled">
            <button class="sm-btn sm-btn-danger" @click="emit('delete', script)">
              {{ i18ns.t('delete') }}
            </button>
          </PermissionWrapper>
        </div>
      </div>
    </div>

    <div v-if="executions.length > 0" class="sm-mobile-results">
      <div class="sm-mobile-results-title">{{ i18ns.t('scriptManager.results') }}</div>
      <UserScriptExecutionList
        :executions="executions"
        :status-label="statusLabel"
        @terminate="emit('terminateOne', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { Permission } from '@/constant/permission'
import { i18ns } from '@/locales'
import UserScriptExecutionList from './UserScriptExecutionList.vue'
import UserScriptSecurityNotice from './UserScriptSecurityNotice.vue'
import type { ExecRecord, ExecStatus, UserScript } from '../types'

defineProps<{
  scriptList: UserScript[]
  runSafetyConfirmed: boolean
  securityNoticeItems: string[]
  executions: ExecRecord[]
  hasNetworkRisk: (script: UserScript) => boolean
  getDetectedApisText: (script: UserScript) => string
  statusLabel: (status: ExecStatus) => string
}>()

const emit = defineEmits<{
  create: []
  runSingle: [script: UserScript]
  history: [script: UserScript]
  edit: [script: UserScript]
  delete: [script: UserScript]
  terminateOne: [exec: ExecRecord]
  'update:runSafetyConfirmed': [value: boolean]
}>()
</script>

<style scoped>
.sm-mobile {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sm-mobile-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sm-logo-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sm-logo-icon {
  font-weight: 700;
  font-size: 15px;
  color: #e8a020;
  letter-spacing: -1px;
}

.sm-logo-text {
  font-weight: 700;
  font-size: 16px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--el-text-color-primary);
}

.sm-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 3px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s,
    opacity 0.15s;
  white-space: nowrap;
  line-height: 1;
}

.sm-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sm-btn-primary {
  background: #e8a020;
  border-color: #e8a020;
  color: #0a0c10;
}

.sm-btn-run {
  background: transparent;
  border-color: #3fb950;
  color: #3fb950;
}

.sm-btn-ghost {
  background: transparent;
  border-color: var(--el-border-color);
  color: var(--el-text-color-secondary);
}

.sm-btn-danger {
  background: transparent;
  border-color: #f85149;
  color: #f85149;
}

.sm-mobile-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sm-mobile-card {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 12px 14px;
  background: var(--el-bg-color);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sm-mobile-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.sm-mobile-card-desc {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.sm-mobile-card-risk {
  font-size: 12px;
  color: #f85149;
  line-height: 1.5;
}

.sm-mobile-card-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.sm-mobile-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sm-mobile-results-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--el-text-color-secondary);
}
</style>