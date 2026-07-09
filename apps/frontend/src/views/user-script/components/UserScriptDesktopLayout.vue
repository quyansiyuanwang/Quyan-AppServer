<template>
  <div class="sm-desktop">
    <aside class="sm-sidebar">
      <header class="sm-sidebar-head">
        <div class="sm-logo-row">
          <span class="sm-logo-icon">&#x276F;_</span>
          <span class="sm-logo-text">{{ i18ns.t('scriptManager.title') }}</span>
        </div>
        <div class="sm-head-actions">
          <PermissionWrapper :require="[Permission.SCRIPT_CREATE]">
            <button class="sm-btn sm-btn-primary" @click="emit('create')">
              <span class="sm-btn-icon">+</span>{{ i18ns.t('scriptManager.create') }}
            </button>
          </PermissionWrapper>
          <button
            class="sm-btn sm-btn-ghost sm-btn-icon-only"
            :class="{ 'sm-spin': loading }"
            @click="emit('refresh')"
          >
            ↻
          </button>
        </div>
      </header>

      <UserScriptSecurityNotice
        :model-value="runSafetyConfirmed"
        :items="securityNoticeItems"
        @update:model-value="emit('update:runSafetyConfirmed', $event)"
      />

      <div class="sm-bulk-bar">
        <span
          class="sm-checkbox sm-select-all-cb"
          :class="{
            'sm-checkbox-on': allSelected,
            'sm-checkbox-indeterminate': someSelected,
          }"
          :title="
            allSelected ? i18ns.t('scriptManager.deselectAll') : i18ns.t('scriptManager.selectAll')
          "
          @click.stop="emit('toggleSelectAll')"
        >
          <span v-if="allSelected" class="sm-check-mark">✓</span>
          <span v-else-if="someSelected" class="sm-check-mark">−</span>
        </span>
        <span class="sm-bulk-hint">
          {{
            selectedIds.size
              ? i18ns.tf('scriptManager.selectedCount', { n: selectedIds.size })
              : i18ns.t('scriptManager.selectHint')
          }}
        </span>
        <button
          v-if="selectedIds.size > 0"
          class="sm-btn sm-btn-ghost sm-btn-xs"
          @click="emit('clearSelection')"
        >
          {{ i18ns.t('scriptManager.clearSelection') }}
        </button>
        <div class="sm-bulk-actions">
          <button
            class="sm-btn sm-btn-run"
            :disabled="selectedIds.size === 0 || !runSafetyConfirmed"
            @click="emit('runSelected')"
          >
            ▶ {{ i18ns.t('scriptManager.runSelected') }}
          </button>
          <button v-if="hasRunning" class="sm-btn sm-btn-danger" @click="emit('terminateAll')">
            ■ {{ i18ns.t('scriptManager.terminateAll') }}
          </button>
          <button v-if="executions.length > 0" class="sm-btn sm-btn-ghost" @click="emit('clearResults')">
            {{ i18ns.t('scriptManager.clearResults') }}
          </button>
        </div>
      </div>

      <div v-if="loading && scriptList.length === 0" class="sm-list-loading">
        <span class="sm-spinner"></span> Loading…
      </div>
      <div v-else class="sm-list">
        <div
          v-for="script in paginatedList"
          :key="script.id"
          class="sm-row"
          :class="{ 'sm-row-selected': selectedIds.has(script.id) }"
          @click="emit('toggleSelect', script, $event)"
        >
          <span class="sm-row-check">
            <span class="sm-checkbox" :class="{ 'sm-checkbox-on': selectedIds.has(script.id) }">
              <span v-if="selectedIds.has(script.id)" class="sm-check-mark">✓</span>
            </span>
          </span>
          <div class="sm-row-body">
            <span class="sm-row-name">{{ script.name }}</span>
            <span v-if="script.description" class="sm-row-desc">{{ script.description }}</span>
            <span v-if="hasNetworkRisk(script)" class="sm-row-risk">
              ⚠
              {{ i18ns.tf('scriptManager.networkRiskDetail', { apis: getDetectedApisText(script) }) }}
            </span>
          </div>
          <div class="sm-row-actions" @click.stop>
            <button
              class="sm-action-btn sm-action-run"
              :disabled="!runSafetyConfirmed"
              :title="runSafetyConfirmed ? i18ns.t('scriptManager.run') : i18ns.t('scriptManager.acknowledgeHint')"
              @click="emit('runSingle', script)"
            >
              ▶
            </button>
            <PermissionWrapper :require="[Permission.SCRIPT_CREATE]" mode="disabled">
              <button class="sm-action-btn" title="Edit" @click="emit('edit', script)">✎</button>
            </PermissionWrapper>
            <button class="sm-action-btn" title="History" @click="emit('history', script)">⧗</button>
            <PermissionWrapper :require="[Permission.SCRIPT_DELETE]" mode="disabled">
              <button class="sm-action-btn sm-action-del" title="Delete" @click="emit('delete', script)">
                ✕
              </button>
            </PermissionWrapper>
          </div>
        </div>
        <div v-if="!loading && scriptList.length === 0" class="sm-empty">
          <span class="sm-empty-icon">&#x276F;</span> No scripts yet
        </div>
      </div>

      <div v-if="scriptList.length > pageSize" class="sm-pagination">
        <el-pagination
          :current-page="currentPage"
          :page-size="pageSize"
          :total="scriptList.length"
          layout="prev, pager, next"
          small
          hide-on-single-page
          @current-change="emit('update:currentPage', $event)"
        />
      </div>
    </aside>

    <main class="sm-console">
      <header class="sm-console-head">
        <div class="sm-console-title">
          <span class="sm-console-label">{{ i18ns.t('scriptManager.results') }}</span>
        </div>
        <div v-if="hasRunning" class="sm-running-badge">
          <span class="sm-dot-pulse"></span> {{ i18ns.t('scriptManager.running') }}
        </div>
      </header>

      <div v-if="executions.length === 0" class="sm-console-empty">
        <div class="sm-empty-terminal">
          <div class="sm-terminal-prompt">$ <span class="sm-cursor-blink">_</span></div>
          <div class="sm-terminal-hint">{{ i18ns.t('scriptManager.noResults') }}</div>
        </div>
      </div>

      <div v-else class="sm-exec-list">
        <UserScriptExecutionList
          :executions="executions"
          :status-label="statusLabel"
          @terminate="emit('terminateOne', $event)"
        />
      </div>
    </main>
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
  loading: boolean
  scriptList: UserScript[]
  paginatedList: UserScript[]
  selectedIds: Set<string>
  allSelected: boolean
  someSelected: boolean
  runSafetyConfirmed: boolean
  securityNoticeItems: string[]
  executions: ExecRecord[]
  hasRunning: boolean
  currentPage: number
  pageSize: number
  hasNetworkRisk: (script: UserScript) => boolean
  getDetectedApisText: (script: UserScript) => string
  statusLabel: (status: ExecStatus) => string
}>()

const emit = defineEmits<{
  create: []
  refresh: []
  toggleSelectAll: []
  clearSelection: []
  runSelected: []
  terminateAll: []
  clearResults: []
  toggleSelect: [script: UserScript, event: MouseEvent]
  runSingle: [script: UserScript]
  edit: [script: UserScript]
  history: [script: UserScript]
  delete: [script: UserScript]
  terminateOne: [exec: ExecRecord]
  'update:runSafetyConfirmed': [value: boolean]
  'update:currentPage': [value: number]
}>()
</script>

<style scoped>
.sm-desktop {
  display: flex;
  height: 100%;
  min-height: 0;
  gap: 0;
}

.sm-sidebar {
  flex: 0 0 40%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-right: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}

.sm-sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
  gap: 10px;
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

.sm-head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
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

.sm-btn-primary:not(:disabled):hover {
  background: #f0b030;
  border-color: #f0b030;
}

.sm-btn-run {
  background: transparent;
  border-color: #3fb950;
  color: #3fb950;
}

.sm-btn-run:not(:disabled):hover {
  background: rgba(63, 185, 80, 0.12);
}

.sm-btn-danger {
  background: transparent;
  border-color: #f85149;
  color: #f85149;
}

.sm-btn-danger:not(:disabled):hover {
  background: rgba(248, 81, 73, 0.12);
}

.sm-btn-ghost {
  background: transparent;
  border-color: var(--el-border-color);
  color: var(--el-text-color-secondary);
}

.sm-btn-ghost:not(:disabled):hover {
  border-color: var(--el-text-color-secondary);
  color: var(--el-text-color-primary);
}

.sm-btn-icon-only {
  padding: 5px 8px;
  font-size: 16px;
  line-height: 1;
}

.sm-btn-icon {
  font-size: 15px;
  font-weight: 400;
}

@keyframes sm-spin-anim {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.sm-spin {
  animation: sm-spin-anim 0.6s linear infinite;
  display: inline-block;
}

.sm-btn-xs {
  padding: 2px 8px;
  font-size: 11px;
}

.sm-checkbox-indeterminate {
  background: rgba(232, 160, 32, 0.3);
  border-color: #e8a020;
}

.sm-select-all-cb {
  cursor: pointer;
  flex-shrink: 0;
}

.sm-bulk-bar {
  padding: 8px 16px;
  border-bottom: 1px solid var(--el-border-color);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
  background: var(--el-fill-color-extra-light);
}

.sm-bulk-hint {
  flex: 1;
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.sm-bulk-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.sm-list {
  flex: 1;
  overflow-y: auto;
}

.sm-list-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--el-text-color-placeholder);
  font-size: 13px;
}

.sm-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--el-border-color);
  border-top-color: #e8a020;
  border-radius: 50%;
  animation: sm-spin-anim 0.7s linear infinite;
}

.sm-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
  user-select: none;
}

.sm-row:hover {
  background: var(--el-fill-color-light);
}

.sm-row-selected {
  background: rgba(232, 160, 32, 0.07);
  border-left: 3px solid #e8a020;
  padding-left: 11px;
}

.sm-row-selected:hover {
  background: rgba(232, 160, 32, 0.12);
}

.sm-row-check {
  flex-shrink: 0;
}

.sm-checkbox {
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--el-border-color);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    border-color 0.12s,
    background 0.12s;
}

.sm-checkbox-on {
  background: #e8a020;
  border-color: #e8a020;
}

.sm-check-mark {
  font-size: 10px;
  font-weight: 700;
  color: #0a0c10;
  line-height: 1;
}

.sm-row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sm-row-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-row-desc {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-row-risk {
  font-size: 11px;
  color: #f85149;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-row-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.sm-row:hover .sm-row-actions {
  opacity: 1;
}

.sm-action-btn {
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  transition:
    background 0.12s,
    color 0.12s,
    border-color 0.12s;
  padding: 0;
}

.sm-action-btn:hover {
  background: var(--el-fill-color);
  border-color: var(--el-border-color);
  color: var(--el-text-color-primary);
}

.sm-action-run:hover {
  color: #3fb950;
  border-color: rgba(63, 185, 80, 0.4);
  background: rgba(63, 185, 80, 0.08);
}

.sm-action-del:hover {
  color: #f85149;
  border-color: rgba(248, 81, 73, 0.4);
  background: rgba(248, 81, 73, 0.08);
}

.sm-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sm-action-btn:disabled:hover {
  background: transparent;
  border-color: transparent;
  color: var(--el-text-color-secondary);
}

.sm-empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--el-text-color-placeholder);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.sm-empty-icon {
  font-size: 24px;
  color: #e8a020;
  opacity: 0.4;
}

.sm-console {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
}

.sm-console-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
  background: var(--el-fill-color-light);
}

.sm-console-title {
  display: flex;
  align-items: center;
  gap: 7px;
}

.sm-console-label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--el-text-color-secondary);
  margin-left: 4px;
}

.sm-running-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 500;
  color: #e3b341;
  letter-spacing: 0.03em;
}

@keyframes sm-dot-pulse-anim {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.2;
  }
}

.sm-dot-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e3b341;
  display: inline-block;
  animation: sm-dot-pulse-anim 1s ease infinite;
}

.sm-console-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sm-empty-terminal {
  text-align: center;
}

.sm-terminal-prompt {
  font-size: 18px;
  font-weight: 500;
  color: #3fb950;
  margin-bottom: 10px;
}

.sm-terminal-hint {
  font-size: 13px;
  color: var(--el-text-color-placeholder);
  letter-spacing: 0.03em;
}

.sm-cursor-blink {
  animation: sm-cursor-blink 1s step-end infinite;
  color: #e8a020;
  font-weight: 700;
}

@keyframes sm-cursor-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

.sm-exec-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sm-pagination {
  flex-shrink: 0;
  padding: 6px 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  display: flex;
  justify-content: center;
}

:global(html.dark) .sm-console {
  background: #0d0f14;
  color: #c9d1d9;
}

:global(html.dark) .sm-console-head {
  background: #161b22;
  border-bottom-color: #21262d;
}

:global(html.dark) .sm-console-label {
  color: #8b949e;
}

:global(html.dark) .sm-terminal-hint {
  color: #4a5568;
}
</style>