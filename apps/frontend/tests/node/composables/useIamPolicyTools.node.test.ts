import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  insertIamAction,
  iamDiagnosticOffset,
  useIamPolicyTools,
} from '@/views/management/ram-management/useIamPolicyTools'
import type { SimulateIamPolicyResponseDto } from '@/client/types.gen'
const { getIamActions, simulatePolicy } = vi.hoisted(() => ({
  getIamActions: vi.fn(),
  simulatePolicy: vi.fn(),
}))
vi.mock('@/service/ramService', () => ({ ramService: { getIamActions, simulatePolicy } }))
const action = 'quyan:ram:ReadUser'
const result: SimulateIamPolicyResponseDto = {
  decision: 'ImplicitDeny',
  reason: 'no-matching-allow',
  matchedStatements: [],
}
beforeEach(() => vi.resetAllMocks())
function filled() {
  const state = useIamPolicyTools()
  state.iamActions.value = [action]
  Object.assign(state.iamSimulationForm, { principalId: ' principal ', action, resource: ' * ' })
  return state
}
describe('IAM catalog action insertion', () => {
  it('inserts/replaces at the cursor while leaving surrounding JSON unchanged', () => {
    expect(insertIamAction('{"Action":""}', 11, 11, action)).toEqual({
      text: '{"Action":"' + action + '"}',
      cursor: 11 + action.length,
    })
    expect(insertIamAction('old value', 0, 3, action)?.text).toBe(action + ' value')
  })
  it.each([
    [-1, 0],
    [0, 99],
    [2, 1],
    [0.5, 1],
  ])('rejects invalid cursor positions %#', (start, end) => {
    expect(insertIamAction('text', start, end, action)).toBeUndefined()
  })
  it('loads the server catalog and clears outdated suggestions on failure', async () => {
    const state = useIamPolicyTools()
    getIamActions.mockResolvedValueOnce([action])
    await state.loadIamActions()
    expect(state.iamActions.value).toEqual([action])
    getIamActions.mockRejectedValueOnce(new Error('Denied'))
    await state.loadIamActions()
    expect(state.iamActions.value).toEqual([])
    expect(state.iamActionsFailed.value).toBe(true)
  })
})
describe('IAM simulation input and response boundaries', () => {
  it('submits only the explicit principal/action/resource, never editor policy contents', async () => {
    const state = filled()
    simulatePolicy.mockResolvedValue(result)
    await state.simulateIamPolicy()
    expect(simulatePolicy).toHaveBeenCalledWith({ principalId: 'principal', action, resource: '*' })
    expect(state.iamSimulationResult.value).toEqual(result)
    state.iamSimulationForm.resource = 'acs:quyan:*:account:account'
    expect(state.iamSimulationResult.value).toBeNull()
  })
  it('rejects unknown Actions and incomplete inputs before requesting simulation', async () => {
    const state = filled()
    state.iamSimulationForm.action = 'client:InventedAction'
    await state.simulateIamPolicy()
    expect(simulatePolicy).not.toHaveBeenCalled()
    expect(state.iamSimulationFailed.value).toBe(true)
  })
  it('does not convert a permission or availability error into an Allow result', async () => {
    const state = filled()
    simulatePolicy.mockRejectedValue(new Error('Forbidden'))
    await state.simulateIamPolicy()
    expect(state.iamSimulationResult.value).toBeNull()
    expect(state.iamSimulationFailed.value).toBe(true)
  })
  it('discards stale and closed-drawer simulation responses', async () => {
    for (const reset of [false, true]) {
      const state = filled()
      let finish!: (value: SimulateIamPolicyResponseDto) => void
      simulatePolicy.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const pending = state.simulateIamPolicy()
      if (reset) state.resetIamSimulation()
      else state.iamSimulationForm.principalId = 'different-principal'
      finish({ ...result, decision: 'Allow', reason: 'matched-allow' })
      await pending
      expect(state.iamSimulationResult.value).toBeNull()
      expect(state.iamSimulating.value).toBe(false)
    }
  })
})

describe('diagnostic cursor offsets', () => {
  it('handles LF, CRLF, non-ASCII UTF-16 columns and invalid positions', () => {
    expect(iamDiagnosticOffset('甲\r\n乙\r\n丙', 2, 1)).toBe(3)
    expect(iamDiagnosticOffset('abc\ndef', 2, 2)).toBe(5)
    expect(iamDiagnosticOffset('abc', 1, 99)).toBe(3)
    expect(iamDiagnosticOffset('abc', 99, 1)).toBe(3)
    expect(iamDiagnosticOffset('abc', 0, 1)).toBe(0)
  })
})
