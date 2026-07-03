export type RemoteTerminalShortcutModifier = 'ctrl' | 'alt' | 'shift' | 'meta'

export type RemoteTerminalShortcutKind = 'sequence' | 'key'

export interface RemoteTerminalShortcut {
  id: string
  label: string
  kind: RemoteTerminalShortcutKind
  sequence: string[]
  key?: string
  modifiers?: RemoteTerminalShortcutModifier[]
  preset?: boolean
}

export interface RemoteTerminalModifierLocks {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

const ANSI_ESCAPE = '\u001b'

export const defaultRemoteTerminalModifierLocks = (): RemoteTerminalModifierLocks => ({
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
})

const createPresetShortcut = (
  id: string,
  label: string,
  sequence: string[],
): RemoteTerminalShortcut => ({
  id,
  label,
  kind: 'sequence',
  sequence,
  preset: true,
})

const createKeyShortcut = (
  id: string,
  label: string,
  key: string,
  modifiers?: RemoteTerminalShortcutModifier[],
): RemoteTerminalShortcut => ({
  id,
  label,
  kind: 'key',
  key,
  modifiers,
  sequence: [],
  preset: true,
})

export const getDefaultRemoteTerminalShortcuts = (): RemoteTerminalShortcut[] => [
  createKeyShortcut('ctrl-c', 'Ctrl+C', 'c', ['ctrl']),
  createKeyShortcut('ctrl-d', 'Ctrl+D', 'd', ['ctrl']),
  createKeyShortcut('ctrl-l', 'Ctrl+L', 'l', ['ctrl']),
  createPresetShortcut('tab', 'Tab', ['\t']),
  createPresetShortcut('esc', 'Esc', [ANSI_ESCAPE]),
  createPresetShortcut('up', '↑', [`${ANSI_ESCAPE}[A`]),
  createPresetShortcut('down', '↓', [`${ANSI_ESCAPE}[B`]),
  createPresetShortcut('right', '→', [`${ANSI_ESCAPE}[C`]),
  createPresetShortcut('left', '←', [`${ANSI_ESCAPE}[D`]),
  createPresetShortcut('enter', 'Enter', ['\r']),
  createPresetShortcut('backspace', '⌫', ['\u007f']),
]

export const getShortcutDisplayLabel = (shortcut: RemoteTerminalShortcut): string => {
  if (shortcut.label.trim()) {
    return shortcut.label.trim()
  }

  if (shortcut.kind === 'key') {
    return formatKeyCombo(shortcut.key ?? '', shortcut.modifiers ?? [])
  }

  return shortcut.sequence.join(' ')
}

export const formatKeyCombo = (
  key: string,
  modifiers: RemoteTerminalShortcutModifier[],
): string => {
  const parts = [
    ...modifiers.map((modifier) => `${modifier.charAt(0).toUpperCase()}${modifier.slice(1)}`),
  ]
  if (key) {
    parts.push(key.length === 1 ? key.toUpperCase() : key)
  }
  return parts.join('+')
}

const normalizeKey = (key: string) => key.trim().toLowerCase()

const mapCtrlKeyToControlChar = (key: string): string | null => {
  if (!key) {
    return null
  }

  if (key === 'space') {
    return '\u0000'
  }

  const char = key[0]
  if (!char) {
    return null
  }

  const code = char.toUpperCase().charCodeAt(0)
  if (code >= 64 && code <= 95) {
    return String.fromCharCode(code - 64)
  }

  if (char === '?') {
    return '\u007f'
  }

  return null
}

const mapNamedKeyToSequence = (key: string, shift: boolean): string | null => {
  switch (key) {
    case 'enter':
      return '\r'
    case 'tab':
      return shift ? `${ANSI_ESCAPE}[Z` : '\t'
    case 'backspace':
      return '\u007f'
    case 'escape':
    case 'esc':
      return ANSI_ESCAPE
    case 'up':
    case 'arrowup':
      return `${ANSI_ESCAPE}[A`
    case 'down':
    case 'arrowdown':
      return `${ANSI_ESCAPE}[B`
    case 'right':
    case 'arrowright':
      return `${ANSI_ESCAPE}[C`
    case 'left':
    case 'arrowleft':
      return `${ANSI_ESCAPE}[D`
    case 'delete':
      return `${ANSI_ESCAPE}[3~`
    case 'home':
      return `${ANSI_ESCAPE}[H`
    case 'end':
      return `${ANSI_ESCAPE}[F`
    case 'pageup':
      return `${ANSI_ESCAPE}[5~`
    case 'pagedown':
      return `${ANSI_ESCAPE}[6~`
    default:
      return null
  }
}

export const buildTerminalSequenceFromKey = (
  key: string,
  modifiers: RemoteTerminalShortcutModifier[] = [],
): string[] => {
  const normalizedKey = normalizeKey(key)
  const modifierSet = new Set(modifiers)
  const shift = modifierSet.has('shift')
  const alt = modifierSet.has('alt')
  const ctrl = modifierSet.has('ctrl')

  let sequence = ''

  if (ctrl) {
    sequence = mapCtrlKeyToControlChar(normalizedKey) ?? ''
  }

  if (!sequence) {
    sequence = mapNamedKeyToSequence(normalizedKey, shift) ?? ''
  }

  if (!sequence && normalizedKey.length === 1) {
    sequence = shift ? normalizedKey.toUpperCase() : normalizedKey
  }

  if (!sequence) {
    return []
  }

  if (alt) {
    sequence = `${ANSI_ESCAPE}${sequence}`
  }

  return [sequence]
}

export const buildTerminalSequenceFromShortcut = (
  shortcut: RemoteTerminalShortcut,
  modifierLocks: RemoteTerminalModifierLocks,
): string[] => {
  if (shortcut.kind === 'sequence') {
    return shortcut.sequence
  }

  return buildTerminalSequenceFromKey(shortcut.key ?? '', [
    ...(shortcut.modifiers ?? []),
    ...Object.entries(modifierLocks)
      .filter(([, active]) => active)
      .map(([modifier]) => modifier as RemoteTerminalShortcutModifier),
  ])
}

export const sanitizeRemoteTerminalShortcuts = (shortcuts: unknown): RemoteTerminalShortcut[] => {
  if (!Array.isArray(shortcuts)) {
    return getDefaultRemoteTerminalShortcuts()
  }

  const normalized = shortcuts
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const candidate = item as Partial<RemoteTerminalShortcut>
      const kind = candidate.kind === 'key' ? 'key' : 'sequence'
      const label = typeof candidate.label === 'string' ? candidate.label : ''
      const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : ''
      const sequence = Array.isArray(candidate.sequence)
        ? candidate.sequence.filter((value): value is string => typeof value === 'string')
        : []
      const key = typeof candidate.key === 'string' ? candidate.key : undefined
      const modifiers = Array.isArray(candidate.modifiers)
        ? candidate.modifiers.filter(
            (value): value is RemoteTerminalShortcutModifier =>
              value === 'ctrl' || value === 'alt' || value === 'shift' || value === 'meta',
          )
        : []

      if (!id) {
        return null
      }

      if (kind === 'key' && !key) {
        return null
      }

      if (kind === 'sequence' && sequence.length === 0) {
        return null
      }

      const normalizedShortcut: RemoteTerminalShortcut = {
        id,
        label,
        kind,
        sequence,
        key,
        modifiers,
        preset: candidate.preset === true,
      }

      return normalizedShortcut
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return normalized.length > 0 ? normalized : getDefaultRemoteTerminalShortcuts()
}
