import { computed, ref, watch } from 'vue'
import type {
  IamPolicyDocument,
  Permission,
  RamPolicyDto,
  ValidateIamPolicyResponseDto,
} from '@/client/types.gen'
import { ramService } from '@/service/ramService'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function isStringList(value: unknown): value is string | string[] {
  return (
    typeof value === 'string' ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  )
}
// Only narrow the transport type. Unknown fields and all policy semantics are validated by the server.
function isPolicyDocument(value: unknown): value is IamPolicyDocument {
  if (!isRecord(value) || value.Version !== '1') return false
  const statements = Array.isArray(value.Statement) ? value.Statement : [value.Statement]
  return (
    statements.length > 0 &&
    statements.every(
      (statement) =>
        isRecord(statement) &&
        (statement.Effect === 'Allow' || statement.Effect === 'Deny') &&
        isStringList(statement.Action) &&
        isStringList(statement.Resource) &&
        (statement.Sid === undefined || typeof statement.Sid === 'string'),
    )
  )
}

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
  const policyFormat = ref<'legacy' | 'iam'>('legacy')
  const policyDocumentText = ref('')
  const policyValidation = ref<ValidateIamPolicyResponseDto | null>(null)
  const validatingPolicy = ref(false)
  const policyValidationFailed = ref(false)
  let revision = 0
  let validatedRevision = -1
  let requestSequence = 0

  watch(
    [policyDocumentText, policyFormat],
    () => {
      revision++
      policyValidation.value = null
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
  const initializePolicyEditor = (policy?: RamPolicyDto) => {
    requestSequence++
    validatingPolicy.value = false
    policyValidation.value = null
    policyValidationFailed.value = false
    validatedRevision = -1
    policyFormat.value = policy?.document ? 'iam' : 'legacy'
    policyDocumentText.value = policy?.document ? JSON.stringify(policy.document, null, 2) : ''
  }

  const validatePolicyDocument = async (): Promise<IamPolicyDocument | undefined> => {
    const currentRevision = revision
    const currentRequest = ++requestSequence
    validatingPolicy.value = true
    policyValidation.value = null
    policyValidationFailed.value = false
    try {
      const document: unknown = JSON.parse(policyDocumentText.value)
      if (!isPolicyDocument(document)) throw new Error('Invalid policy document structure')
      const result = await ramService.validatePolicy(document)
      if (currentRevision !== revision || currentRequest !== requestSequence) return undefined
      if (!result.valid) throw new Error('Policy validation failed')
      policyValidation.value = result
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
    policyFormat,
    policyDocumentText,
    policyValidation,
    validatingPolicy,
    policyValidationFailed,
    hasPolicyDeny,
    initializePolicyEditor,
    validatePolicyDocument,
    getValidatedPolicyDocument,
  }
}
