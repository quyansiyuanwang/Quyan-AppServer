<template>
  <TransitionGroup name="sm-exec-fade">
    <div
      v-for="exec in executions"
      :key="exec.id"
      class="sm-exec-card"
      :class="`sm-exec-${exec.status}`"
    >
      <div class="sm-exec-head">
        <span class="sm-exec-status-dot" :class="`sm-dot-${exec.status}`"></span>
        <span class="sm-exec-name">{{ exec.scriptName }}</span>
        <span class="sm-exec-meta">
          <span class="sm-exec-badge" :class="`sm-badge-${exec.status}`">
            {{ statusLabel(exec.status) }}
          </span>
          <span v-if="exec.durationMs !== undefined" class="sm-exec-ms"
            >{{ exec.durationMs }}ms</span
          >
        </span>
        <button
          v-if="exec.status === 'running'"
          class="sm-exec-kill"
          @click="emit('terminate', exec)"
        >
          ■ {{ i18ns.t('scriptManager.terminate') }}
        </button>
      </div>
      <pre
        class="sm-exec-output">{{ exec.output || i18ns.t('scriptManager.noOutput') }}<span v-if="exec.status === 'running'" class="sm-cursor-blink"> _</span></pre>
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import type { ExecRecord, ExecStatus } from '../types'

defineProps<{
  executions: ExecRecord[]
  statusLabel: (status: ExecStatus) => string
}>()

const emit = defineEmits<{
  terminate: [exec: ExecRecord]
}>()
</script>

<style scoped>
.sm-exec-card {
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  flex-shrink: 0;
  transition: border-color 0.2s;
}

.sm-exec-running {
  border-color: #e3b341;
  box-shadow: 0 0 0 1px rgba(227, 179, 65, 0.15);
}

.sm-exec-done {
  border-color: #27c93f;
}

.sm-exec-error {
  border-color: #f85149;
}

.sm-exec-terminated {
  border-color: #30363d;
  opacity: 0.7;
}

.sm-exec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color);
}

.sm-exec-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sm-dot-running {
  background: #e3b341;
  animation: sm-dot-blink 0.9s ease infinite;
}

.sm-dot-done {
  background: #27c93f;
}

.sm-dot-error {
  background: #f85149;
}

.sm-dot-terminated {
  background: #4a5568;
}

.sm-exec-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-exec-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.sm-exec-badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 2px;
  border: 1px solid transparent;
}

.sm-badge-running {
  color: #e3b341;
  border-color: rgba(227, 179, 65, 0.4);
  background: rgba(227, 179, 65, 0.1);
}

.sm-badge-done {
  color: #27c93f;
  border-color: rgba(39, 201, 63, 0.4);
  background: rgba(39, 201, 63, 0.1);
}

.sm-badge-error {
  color: #f85149;
  border-color: rgba(248, 81, 73, 0.4);
  background: rgba(248, 81, 73, 0.1);
}

.sm-badge-terminated {
  color: #8b949e;
  border-color: rgba(139, 148, 158, 0.4);
  background: rgba(139, 148, 158, 0.08);
}

.sm-exec-ms {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.sm-exec-kill {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 8px;
  border-radius: 2px;
  border: 1px solid rgba(248, 81, 73, 0.5);
  background: rgba(248, 81, 73, 0.1);
  color: #f85149;
  cursor: pointer;
  transition: background 0.12s;
  white-space: nowrap;
}

.sm-exec-kill:hover {
  background: rgba(248, 81, 73, 0.2);
}

.sm-exec-output {
  margin: 0;
  padding: 10px 14px;
  background: #0d1117;
  color: #c9d1d9;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

@keyframes sm-dot-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.2;
  }
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

.sm-cursor-blink {
  animation: sm-cursor-blink 1s step-end infinite;
  color: #e8a020;
  font-weight: 700;
}

.sm-exec-fade-enter-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.sm-exec-fade-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}

:global(html.dark) .sm-exec-card {
  border-color: #21262d;
}

:global(html.dark) .sm-exec-head {
  background: #161b22;
  border-bottom-color: #21262d;
}

:global(html.dark) .sm-exec-name {
  color: #e6edf3;
}

:global(html.dark) .sm-exec-ms {
  color: #4a5568;
}
</style>
