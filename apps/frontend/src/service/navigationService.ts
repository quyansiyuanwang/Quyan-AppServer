const sameDocumentUrl = (target: string): boolean => {
  try {
    return new URL(target, window.location.href).toString() === window.location.href
  } catch {
    return false
  }
}

export const replaceDocument = (target: string): boolean => {
  if (sameDocumentUrl(target)) return false
  window.location.replace(target)
  return true
}

export const assignDocument = (target: string): boolean => {
  if (sameDocumentUrl(target)) return false
  window.location.assign(target)
  return true
}

export const reloadDocument = (): void => {
  window.location.reload()
}
