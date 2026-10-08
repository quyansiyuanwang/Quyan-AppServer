import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IamPolicyDocument, RamPolicyDto } from '@/client/types.gen'
import {
  policyAuthorizationPayload,
  useIamPolicyEditor,
} from '@/views/management/ram-management/useIamPolicyEditor'

const { diagnosePolicy } = vi.hoisted(() => ({ diagnosePolicy: vi.fn() }))
vi.mock('@/service/ramService', () => ({ ramService: { diagnosePolicy } }))
const document: IamPolicyDocument = {
  Version: '1',
  Statement: { Effect: 'Allow', Action: 'quyan:ram:ReadUser', Resource: '*' },
}
const valid = { valid: true, diagnostics: [], delegation: 'not-evaluated', document: { ...document, Statement: [document.Statement] }, documentHash: 'hash-1', broadWildcard: false }
const policy: RamPolicyDto = {
  id: 'p1',
  accountOwnerId: 'a1',
  name: 'policy',
  permissions: [],
  type: 'custom',
  status: 1,
  createTime: '',
  updateTime: '',
  document,
  documentHash: 'hash-1',
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('IAM document editor validation', () => {
  it('reuses server-normalized documents only until content changes', async () => {
    const editor = useIamPolicyEditor()
    editor.initializePolicyEditor(policy)
    const normalized = { ...document, Statement: [document.Statement] }
    diagnosePolicy.mockResolvedValue({ ...valid, document: normalized })
    expect(await editor.validatePolicyDocument()).toEqual(normalized)
    expect(await editor.getValidatedPolicyDocument()).toEqual(normalized)
    expect(diagnosePolicy).toHaveBeenCalledTimes(1)
    editor.policyDocumentText.value += ' '
    expect(editor.policyValidation.value).toBeNull()
    await editor.getValidatedPolicyDocument()
    expect(diagnosePolicy).toHaveBeenCalledTimes(2)
  })
  it.each([
    '{',
    '{"Version":"2","Statement":[]}',
    '{"Version":"1","Statement":{"Effect":"Maybe","Action":"*","Resource":"*"}}',
  ])('blocks malformed editor input %s', async (text) => {
    diagnosePolicy.mockResolvedValue({ valid: false, diagnostics: [], delegation: 'not-evaluated' })
    const editor = useIamPolicyEditor()
    editor.policyDocumentText.value = text
    expect(await editor.validatePolicyDocument()).toBeUndefined()
    expect(editor.policyValidationFailed.value).toBe(true)
    expect(diagnosePolicy).toHaveBeenCalledWith(text)
  })
  it('sends unsupported fields unchanged to the authoritative server validator', async () => {
    const editor = useIamPolicyEditor()
    const unsupported = { ...document, Condition: { unsupported: true } }
    editor.policyDocumentText.value = JSON.stringify(unsupported)
    diagnosePolicy.mockRejectedValue(new Error('Unsupported field'))
    expect(await editor.validatePolicyDocument()).toBeUndefined()
    expect(diagnosePolicy).toHaveBeenCalledWith(JSON.stringify(unsupported))
    expect(editor.policyValidationFailed.value).toBe(true)
    expect(editor.policyValidation.value).toBeNull()
  })
  it('retains source diagnostics for invalid input and clears them immediately after editing', async () => {
    const diagnostic = { code: 'json-syntax', severity: 'error', path: '', line: 1, column: 2, messageKey: 'RamManagement.diagnosticMessages.json-syntax' }
    diagnosePolicy.mockResolvedValue({ valid: false, diagnostics: [diagnostic], delegation: 'not-evaluated' })
    const editor = useIamPolicyEditor()
    editor.policyDocumentText.value = '{'
    await editor.validatePolicyDocument()
    expect(editor.policyDiagnostics.value).toEqual([diagnostic])
    expect(editor.policyValidation.value).toBeNull()
    editor.policyDocumentText.value = '{}'
    expect(editor.policyDiagnostics.value).toEqual([])
  })
  it('fails closed when a supposedly valid response contains an error diagnostic', async () => {
    diagnosePolicy.mockResolvedValue({ ...valid, diagnostics: [{ severity: 'error' }] })
    const editor = useIamPolicyEditor()
    editor.initializePolicyEditor(policy)
    expect(await editor.getValidatedPolicyDocument()).toBeUndefined()
    expect(editor.policyValidation.value).toBeNull()
  })
  it('discards validation responses when text or format changed while awaiting the server', async () => {
    for (const change of ['text', 'format']) {
      const editor = useIamPolicyEditor()
      editor.initializePolicyEditor(policy)
      let finish!: (value: typeof valid) => void
      diagnosePolicy.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const pending = editor.validatePolicyDocument()
      if (change === 'text') editor.policyDocumentText.value += ' '
      else editor.policyFormat.value = 'legacy'
      finish(valid)
      expect(await pending).toBeUndefined()
      expect(editor.policyValidation.value).toBeNull()
    }
  })
  it('only accepts the latest validation request and ignores responses after drawer reset', async () => {
    const editor = useIamPolicyEditor()
    editor.initializePolicyEditor(policy)
    let finish!: (value: typeof valid) => void
    diagnosePolicy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const first = editor.validatePolicyDocument()
    diagnosePolicy.mockResolvedValueOnce(valid)
    await editor.validatePolicyDocument()
    finish({ ...valid, documentHash: 'stale' })
    expect(await first).toBeUndefined()
    expect(editor.policyValidation.value?.documentHash).toBe('hash-1')
    diagnosePolicy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const oldDrawer = editor.validatePolicyDocument()
    editor.initializePolicyEditor()
    finish(valid)
    expect(await oldDrawer).toBeUndefined()
    expect(editor.policyValidation.value).toBeNull()
    expect(editor.policyDocumentText.value).toBe('')
    expect(editor.validatingPolicy.value).toBe(false)
  })
  it('shows Deny and broad-scope warnings only for the currently validated document', async () => {
    const editor = useIamPolicyEditor()
    editor.initializePolicyEditor(policy)
    diagnosePolicy.mockResolvedValue({
      ...valid,
      broadWildcard: true,
      document: { ...document, Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }] },
    })
    await editor.validatePolicyDocument()
    expect(editor.hasPolicyDeny.value).toBe(true)
    expect(editor.policyValidation.value?.broadWildcard).toBe(true)
    editor.policyDocumentText.value = ''
    expect(editor.hasPolicyDeny.value).toBe(false)
  })
})

describe('IAM save payload and downgrade prevention', () => {
  it('sends documents with the original policy hash, without legacy permission arrays', () => {
    expect(policyAuthorizationPayload(policy, [], document)).toEqual({
      document,
      expectedDocumentHash: 'hash-1',
    })
    expect(policyAuthorizationPayload(null, [], document)).toEqual({ document })
    expect(policyAuthorizationPayload(null, [])).toEqual({ permissions: [] })
  })
  it('fails closed for versioned policies without a document or concurrency hash', () => {
    expect(() => policyAuthorizationPayload(policy, [])).toThrow()
    expect(() =>
      policyAuthorizationPayload({ ...policy, documentHash: undefined }, [], document),
    ).toThrow()
  })
})
