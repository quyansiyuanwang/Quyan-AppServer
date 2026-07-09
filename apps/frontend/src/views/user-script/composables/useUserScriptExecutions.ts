import { computed, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { userScriptExecutionService } from '@/service/userScriptExecutionService'
import type { ExecRecord, ExecStatus, UserScript } from '../types'

const NETWORK_API_RULES = [
  { label: 'fetch()', pattern: /\bfetch\s*\(/ },
  { label: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { label: 'WebSocket', pattern: /\bWebSocket\b/ },
  { label: 'navigator.sendBeacon()', pattern: /\bnavigator\s*\.\s*sendBeacon\s*\(/ },
  {
    label: 'axios',
    pattern: /\baxios\b(?:\s*\(|\s*\.(?:get|post|put|delete|patch|request))/,
  },
] as const

export function useUserScriptExecutions() {
  const executions = ref<ExecRecord[]>([])
  const runSafetyConfirmed = ref(false)

  const hasRunning = computed(() => executions.value.some((entry) => entry.status === 'running'))
  const securityNoticeItems = computed(() => [
    i18ns.t('scriptManager.securityNoticeUntrusted'),
    i18ns.t('scriptManager.securityNoticePublicNetwork'),
    i18ns.t('scriptManager.securityNoticeSensitive'),
    i18ns.t('scriptManager.securityNoticeDoubleConfirm'),
  ])

  function statusLabel(status: ExecStatus) {
    const map: Record<ExecStatus, string> = {
      running: i18ns.t('scriptManager.status.running'),
      done: i18ns.t('scriptManager.status.done'),
      error: i18ns.t('scriptManager.status.error'),
      terminated: i18ns.t('scriptManager.status.terminated'),
    }

    return map[status]
  }

  function makeExecId() {
    return Math.random().toString(36).slice(2)
  }

  function getDetectedApis(script: UserScript): string[] {
    return NETWORK_API_RULES.filter((rule) => rule.pattern.test(script.content)).map(
      (rule) => rule.label,
    )
  }

  function getDetectedApisText(script: UserScript): string {
    return getDetectedApis(script).join(', ')
  }

  function hasNetworkRisk(script: UserScript): boolean {
    return getDetectedApis(script).length > 0
  }

  async function confirmBeforeRun(count: number) {
    await ElMessageBox.confirm(
      i18ns.tf('scriptManager.runConfirmMessage', { n: count }),
      i18ns.t('scriptManager.runConfirmTitle'),
      {
        confirmButtonText: i18ns.t('scriptManager.confirmRun'),
        cancelButtonText: i18ns.t('cancel'),
        type: 'warning',
      },
    )
  }

  async function confirmNetworkRisk(scripts: UserScript[]) {
    const riskyScripts = scripts
      .map((script) => ({ scriptName: script.name, apis: getDetectedApis(script) }))
      .filter((item) => item.apis.length > 0)

    if (riskyScripts.length === 0) return

    const lines = [
      i18ns.t('scriptManager.networkRiskIntro'),
      ...riskyScripts.map((item) => `• ${item.scriptName}: ${item.apis.join(', ')}`),
      '',
      i18ns.t('scriptManager.networkRiskPublicNetwork'),
    ]

    await ElMessageBox.confirm(lines.join('\n'), i18ns.t('scriptManager.networkRiskTitle'), {
      confirmButtonText: i18ns.t('scriptManager.confirmHighRiskRun'),
      cancelButtonText: i18ns.t('cancel'),
      type: 'error',
    })
  }

  async function ensureRunAllowed(scripts: UserScript[]) {
    if (!runSafetyConfirmed.value) {
      ElMessage.warning(i18ns.t('scriptManager.reviewRequired'))
      return false
    }

    try {
      await confirmBeforeRun(scripts.length)
      await confirmNetworkRisk(scripts)
      return true
    } catch {
      return false
    }
  }

  function spawnWorker(script: UserScript) {
    const execId = makeExecId()
    const record: ExecRecord = {
      id: execId,
      scriptId: script.id,
      scriptName: script.name,
      status: 'running',
      output: '',
      startTime: Date.now(),
    }

    executions.value.unshift(record)

    const worker = new Worker(new URL('@/workers/script-runner.worker.ts', import.meta.url), {
      type: 'module',
    })

    record.worker = worker

    worker.onmessage = async (event: MessageEvent) => {
      const currentRecord = executions.value.find((entry) => entry.id === execId)
      if (!currentRecord) return

      if (event.data.type === 'log') {
        currentRecord.output += (currentRecord.output ? '\n' : '') + event.data.text
        return
      }

      if (event.data.type === 'done') {
        currentRecord.durationMs = Date.now() - currentRecord.startTime
        currentRecord.status = event.data.hasError ? 'error' : 'done'
        currentRecord.worker = undefined
        worker.terminate()

        await userScriptExecutionService
          .saveExecution({
            scriptId: script.id,
            scriptName: script.name,
            contentSnapshot: script.content,
            output: (event.data.logs as string[]).join('\n'),
            durationMs: currentRecord.durationMs,
          })
          .catch(() => {})
      }
    }

    worker.onerror = (event: ErrorEvent) => {
      const currentRecord = executions.value.find((entry) => entry.id === execId)
      if (!currentRecord) return

      currentRecord.output += (currentRecord.output ? '\n' : '') + '[worker error] ' + event.message
      currentRecord.status = 'error'
      currentRecord.durationMs = Date.now() - currentRecord.startTime
      currentRecord.worker = undefined
      worker.terminate()
    }

    worker.postMessage({ code: script.content })
  }

  async function runSingle(script: UserScript) {
    if (!(await ensureRunAllowed([script]))) return
    spawnWorker(script)
  }

  async function runMany(scripts: UserScript[]) {
    if (scripts.length === 0) return
    if (!(await ensureRunAllowed(scripts))) return

    for (const script of scripts) {
      spawnWorker(script)
    }
  }

  function terminateOne(exec: ExecRecord) {
    if (exec.worker) {
      exec.worker.terminate()
      exec.worker = undefined
    }

    exec.status = 'terminated'
    exec.durationMs = Date.now() - exec.startTime
    exec.output += (exec.output ? '\n' : '') + '[terminated]'
  }

  function terminateAll() {
    executions.value.filter((entry) => entry.status === 'running').forEach(terminateOne)
  }

  function clearResults() {
    terminateAll()
    executions.value = []
  }

  onUnmounted(() => {
    executions.value
      .filter((entry) => entry.status === 'running')
      .forEach((entry) => {
        entry.worker?.terminate()
      })
  })

  return {
    executions,
    runSafetyConfirmed,
    hasRunning,
    securityNoticeItems,
    statusLabel,
    getDetectedApisText,
    hasNetworkRisk,
    runSingle,
    runMany,
    terminateOne,
    terminateAll,
    clearResults,
  }
}