import { computed, ref, watch } from 'vue'
import type { IamDiagnostic } from '@quyan/shared'
import type {
  IamPolicyDocument,
  Permission,
  RamPolicyDto,
  ValidateIamPolicyResponseDto,
} from '@/client/types.gen'
import { ramService } from '@/service/ramService'

export function policyAuthorizationPayload(
  policy: RamPolicyDto | null,
  permissions: Permission[],
  document?: IamPolicyDocument,
) {
  if (policy?.document && (!document || !policy.documentHash)) {
    throw new Error('Reload the IAM policy before saving')
  }
  return document
    ? { document, ...(policy?.documentHash ? { expectedDocumentHash: policy.documentHash } : {}) }
    : { permissions }
}

export function useIamPolicyEditor() {
  const policyEditorGeneration = ref(0)
  const policyFormat = ref<'legacy' | 'iam'>('legacy')
  const policyEditorMode = ref<'json' | 'visual'>('json')
  const visualPolicyValid = ref(true)
  const policyDocumentText = ref('')
  const policyValidation = ref<ValidateIamPolicyResponseDto | null>(null)
  const policyDiagnostics = ref<IamDiagnostic[]>([])
  const validatingPolicy = ref(false)
  const policyValidationFailed = ref(false)
  let revision = 0
  let validatedRevision = -1
  let requestSequence = 0

  watch(
    [policyDocumentText, policyFormat, policyEditorMode, visualPolicyValid],
    () => {
      revision++
      policyValidation.value = null
      policyDiagnostics.value = []
      policyValidationFailed.value = false
    },
    { flush: 'sync' },
  )

  const hasPolicyDeny = computed(() => {
    const statement = policyValidation.value?.document.Statement
    return (Array.isArray(statement) ? statement : statement ? [statement] : []).some(
      (item) => item.Effect === 'Deny',
    )
  })
  const cancelPolicyValidation = () => {
    requestSequence++
    revision++
    validatingPolicy.value = false
    policyValidation.value = null
    policyDiagnostics.value = []
    policyValidationFailed.value = false
  }
  const initializePolicyEditor = (policy?: RamPolicyDto) => {
    requestSequence++
    policyEditorGeneration.value++
    policyEditorMode.value = 'json'
    visualPolicyValid.value = true
    validatingPolicy.value = false
    policyValidation.value = null
    policyDiagnostics.value = []
    policyValidationFailed.value = false
    validatedRevision = -1
    policyFormat.value = policy?.document ? 'iam' : 'legacy'
    policyDocumentText.value = policy?.document ? JSON.stringify(policy.document, null, 2) : ''
  }

  const validatePolicyDocument = async (): Promise<IamPolicyDocument | undefined> => {
    if (policyEditorMode.value === 'visual' && !visualPolicyValid.value) {
      policyValidationFailed.value = true
      return undefined
    }
    const currentRevision = revision
    const currentRequest = ++requestSequence
    validatingPolicy.value = true
    policyValidation.value = null
    policyDiagnostics.value = []
    policyValidationFailed.value = false
    try {
      const result = await ramService.diagnosePolicy(policyDocumentText.value)
      if (currentRevision !== revision || currentRequest !== requestSequence) return undefined
      policyDiagnostics.value = result.diagnostics
      if (
        !result.valid ||
        !result.document ||
        !result.documentHash ||
        result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      )
        throw new Error('Policy validation failed')
      policyValidation.value = {
        valid: true,
        document: result.document,
        documentHash: result.documentHash,
        broadWildcard: result.document.Statement.some(
          (statement) => statement.Action.includes('*') && statement.Resource.includes('*'),
        ),
      }
      validatedRevision = revision
      return result.document
    } catch {
      if (currentRevision === revision && currentRequest === requestSequence) {
        policyValidationFailed.value = true
      }
      return undefined
    } finally {
      if (currentRequest === requestSequence) validatingPolicy.value = false
    }
  }

  const getValidatedPolicyDocument = async () => {
    if (policyValidation.value && validatedRevision === revision)
      return policyValidation.value.document
    return validatePolicyDocument()
  }

  return {
    policyEditorGeneration,
    policyFormat,
    policyEditorMode,
    visualPolicyValid,
    policyDocumentText,
    policyValidation,
    policyDiagnostics,
    validatingPolicy,
    policyValidationFailed,
    hasPolicyDeny,
    initializePolicyEditor,
    cancelPolicyValidation,
    validatePolicyDocument,
    getValidatedPolicyDocument,
  }
}
