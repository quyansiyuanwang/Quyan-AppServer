import { describe, expect, it } from 'vitest'
import {
  buildTerminalSequenceFromShortcut,
  defaultRemoteTerminalModifierLocks,
  formatKeyCombo,
  getDefaultRemoteTerminalShortcuts,
  sanitizeRemoteTerminalShortcuts,
  type RemoteTerminalShortcut,
} from '@/utils/remoteTerminalShortcuts'

describe('remoteTerminalShortcuts', () => {
  it('formats key combos predictably', () => {
    expect(formatKeyCombo('c', ['ctrl'])).toBe('Ctrl+C')
    expect(formatKeyCombo('ArrowUp', ['alt', 'shift'])).toBe('Alt+Shift+ArrowUp')
  })

  it('builds control-key shortcuts with locked modifiers', () => {
    const shortcut: RemoteTerminalShortcut = {
      id: 'custom-copy-break',
      label: 'Ctrl+C',
      kind: 'key',
      key: 'c',
      modifiers: ['ctrl'],
      sequence: [],
    }

    const output = buildTerminalSequenceFromShortcut(shortcut, {
      ...defaultRemoteTerminalModifierLocks(),
      alt: true,
    })

    expect(output).toEqual(['\u001b\u0003'])
  })

  it('keeps raw sequence shortcuts unchanged', () => {
    const shortcut: RemoteTerminalShortcut = {
      id: 'custom-seq',
      label: 'Seq',
      kind: 'sequence',
      sequence: ['echo test\r', '\u001b[A'],
    }

    expect(buildTerminalSequenceFromShortcut(shortcut, defaultRemoteTerminalModifierLocks())).toEqual([
      'echo test\r',
      '\u001b[A',
    ])
  })

  it('sanitizes invalid shortcut payloads', () => {
    const sanitized = sanitizeRemoteTerminalShortcuts([
      {
        id: 'valid-key',
        label: 'Valid',
        kind: 'key',
        key: 'd',
        modifiers: ['ctrl', 'invalid'],
        sequence: [],
      },
      {
        id: 'missing-seq',
        kind: 'sequence',
        sequence: [],
      },
    ])

    expect(sanitized).toEqual([
      {
        id: 'valid-key',
        label: 'Valid',
        kind: 'key',
        key: 'd',
        modifiers: ['ctrl'],
        sequence: [],
        preset: false,
      },
    ])
  })

  it('falls back to defaults for non-array payloads', () => {
    expect(sanitizeRemoteTerminalShortcuts(null)).toEqual(getDefaultRemoteTerminalShortcuts())
  })
})
