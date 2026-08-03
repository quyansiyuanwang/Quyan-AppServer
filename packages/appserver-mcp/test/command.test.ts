import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/command.js'

describe('command runner', () => {
  test('uses argument arrays and redacts sensitive output', async () => {
    const result = await runCommand(
      process.execPath,
      [
        '-e',
        'console.log("api_key=should-not-leak"); console.error("Authorization: Bearer should-not-leak")',
      ],
      process.cwd(),
      30_000,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('api_key=[REDACTED]')
    expect(result.stderr).toContain('Authorization: Bearer [REDACTED]')
    expect(result.stdout).not.toContain('should-not-leak')
    expect(result.stderr).not.toContain('should-not-leak')
  })
})
