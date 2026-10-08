/** Convert one-based diagnostic positions to a UTF-16 textarea cursor offset. */
export function iamDiagnosticOffset(text: string, line: number, column: number): number {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return 0
  const lines = text.split(/\r\n|\r|\n/)
  if (line > lines.length) return text.length
  let offset = 0
  const newline = /\r\n|\r|\n/g
  for (let i = 1; i < line; i++) {
    const match = newline.exec(text)
    if (!match) return text.length
    offset = match.index + match[0].length
  }
  return offset + Math.min(column - 1, lines[line - 1]!.length)
}

import { reactive, ref, watch } from 'vue'
import type { SimulateIamPolicyResponseDto } from '@/client/types.gen'
import { ramService } from '@/service/ramService'

/** Insert a catalog action at the textarea's retained cursor/selection, without rewriting JSON. */
export function insertIamAction(text: string, start: number, end: number, action: string) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > text.length
  )
    return undefined
  return { text: text.slice(0, start) + action + text.slice(end), cursor: start + action.length }
}

export function useIamPolicyTools() {
  const iamActions = ref<string[]>([])
  const iamActionsLoading = ref(false)
  const iamActionsFailed = ref(false)
  let catalogRequest = 0
  const loadIamActions = async () => {
    const sequence = ++catalogRequest
    iamActionsLoading.value = true
    iamActionsFailed.value = false
    iamActions.value = []
    try {
      const actions = await ramService.getIamActions()
      if (sequence === catalogRequest) iamActions.value = actions
    } catch {
      if (sequence === catalogRequest) iamActionsFailed.value = true
    } finally {
      if (sequence === catalogRequest) iamActionsLoading.value = false
    }
  }

  const iamSimulationVisible = ref(false)
  const iamSimulationForm = reactive({ principalId: '', action: '', resource: '' })
  const iamSimulationResult = ref<SimulateIamPolicyResponseDto | null>(null)
  const iamSimulating = ref(false)
  const iamSimulationFailed = ref(false)
  let revision = 0
  let simulationRequest = 0
  watch(
    () => [iamSimulationForm.principalId, iamSimulationForm.action, iamSimulationForm.resource],
    () => {
      revision++
      iamSimulationResult.value = null
      iamSimulationFailed.value = false
    },
    { flush: 'sync' },
  )
  const resetIamSimulation = () => {
    simulationRequest++
    Object.assign(iamSimulationForm, { principalId: '', action: '', resource: '' })
    iamSimulationResult.value = null
    iamSimulationFailed.value = false
    iamSimulating.value = false
  }
  const simulateIamPolicy = async () => {
    const sequence = ++simulationRequest
    const inputRevision = revision
    const input = {
      principalId: iamSimulationForm.principalId.trim(),
      action: iamSimulationForm.action,
      resource: iamSimulationForm.resource.trim(),
    }
    iamSimulating.value = true
    iamSimulationResult.value = null
    iamSimulationFailed.value = false
    try {
      if (!input.principalId || !input.resource || !iamActions.value.includes(input.action))
        throw new Error('Invalid simulation input')
      const result = await ramService.simulatePolicy(input)
      if (sequence === simulationRequest && inputRevision === revision)
        iamSimulationResult.value = result
    } catch {
      if (sequence === simulationRequest && inputRevision === revision)
        iamSimulationFailed.value = true
    } finally {
      if (sequence === simulationRequest) iamSimulating.value = false
    }
  }

  return {
    iamActions,
    iamActionsLoading,
    iamActionsFailed,
    loadIamActions,
    iamSimulationVisible,
    iamSimulationForm,
    iamSimulationResult,
    iamSimulationFailed,
    iamSimulating,
    resetIamSimulation,
    simulateIamPolicy,
  }
}
