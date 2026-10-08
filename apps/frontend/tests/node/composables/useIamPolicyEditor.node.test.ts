import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IamPolicyDocument, RamPolicyDto } from '@/client/types.gen'
import {
  policyAuthorizationPayload,
  useIamPolicyEditor,
} from '@/views/management/ram-management/useIamPolicyEditor'

const { validatePolicy } = vi.hoisted(() => ({ validatePolicy: vi.fn() }))
vi.mock('@/service/ramService', () => ({ ramService: { validatePolicy } }))
const document: IamPolicyDocument = {
  Version: '1',
  Statement: { Effect: 'Allow', Action: 'quyan:ram:ReadUser', Resource: '*' },
}
const valid = { valid: true, document, documentHash: 'hash-1', broadWildcard: false }
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
    validatePolicy.mockResolvedValue({ ...valid, document: normalized })
    expect(await editor.validatePolicyDocument()).toEqual(normalized)
    expect(await editor.getValidatedPolicyDocument()).toEqual(normalized)
    expect(validatePolicy).toHaveBeenCalledTimes(1)
    editor.policyDocumentText.value += ' '
    expect(editor.policyValidation.value).toBeNull()
    await editor.getValidatedPolicyDocument()
    expect(validatePolicy).toHaveBeenCalledTimes(2)
  })
  it.each([
    '{',
    '{"Version":"2","Statement":[]}',
    '{"Version":"1","Statement":{"Effect":"Maybe","Action":"*","Resource":"*"}}',
  ])('blocks malformed editor input %s', async (text) => {
    const editor = useIamPolicyEditor()
    editor.policyDocumentText.value = text
    expect(await editor.validatePolicyDocument()).toBeUndefined()
    expect(editor.policyValidationFailed.value).toBe(true)
    expect(validatePolicy).not.toHaveBeenCalled()
  })
  it('sends unsupported fields unchanged to the authoritative server validator', async () => {
    const editor = useIamPolicyEditor()
    const unsupported = { ...document, Condition: { unsupported: true } }
    editor.policyDocumentText.value = JSON.stringify(unsupported)
    validatePolicy.mockRejectedValue(new Error('Unsupported field'))
    expect(await editor.validatePolicyDocument()).toBeUndefined()
    expect(validatePolicy).toHaveBeenCalledWith(unsupported)
    expect(editor.policyValidationFailed.value).toBe(true)
    expect(editor.policyValidation.value).toBeNull()
  })
  it('discards validation responses when text or format changed while awaiting the server', async () => {
    for (const change of ['text', 'format']) {
      const editor = useIamPolicyEditor()
      editor.initializePolicyEditor(policy)
      let finish!: (value: typeof valid) => void
      validatePolicy.mockImplementationOnce(
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
    validatePolicy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const first = editor.validatePolicyDocument()
    validatePolicy.mockResolvedValueOnce(valid)
    await editor.validatePolicyDocument()
    finish({ ...valid, documentHash: 'stale' })
    expect(await first).toBeUndefined()
    expect(editor.policyValidation.value?.documentHash).toBe('hash-1')
    validatePolicy.mockImplementationOnce(
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
    validatePolicy.mockResolvedValue({
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
