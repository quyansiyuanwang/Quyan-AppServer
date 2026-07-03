const legacyCopy = (text: string): boolean => {
  if (typeof document === 'undefined') return false

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', 'true')
  textArea.style.position = 'fixed'
  textArea.style.opacity = '0'
  textArea.style.pointerEvents = 'none'
  textArea.style.top = '-9999px'

  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()

  let copied = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy fallback for browsers without navigator.clipboard support
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }

  document.body.removeChild(textArea)
  return copied
}

export const copyTextWithFallback = async (text: string): Promise<boolean> => {
  const normalizedText = String(text ?? '')

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(normalizedText)
      return true
    } catch {
      // Fall through to legacy copy.
    }
  }

  return legacyCopy(normalizedText)
}
