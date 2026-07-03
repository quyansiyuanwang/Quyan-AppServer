const SIX_DIGIT_CODE_PATTERN = /^\d{6}$/
const RECOVERY_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/

export const validateTwoFactorCode = (code: string, allowRecovery: boolean = false): boolean => {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return false

  if (allowRecovery && RECOVERY_CODE_PATTERN.test(normalized)) {
    return true
  }

  return SIX_DIGIT_CODE_PATTERN.test(normalized)
}
