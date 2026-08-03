import { spawn } from 'node:child_process'
import type { CommandResult } from './types.js'

const OUTPUT_LIMIT = 16 * 1024
const SENSITIVE_OUTPUT_PATTERNS = [
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*)[^\s'"]+/gi,
  /(authorization:\s*bearer\s+)[^\s'"]+/gi,
]

function redactSensitiveOutput(value: string): string {
  return SENSITIVE_OUTPUT_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, '$1[REDACTED]'),
    value,
  )
}

function appendLimited(current: string, chunk: string): { value: string; truncated: boolean } {
  const joined = current + chunk
  if (Buffer.byteLength(joined, 'utf8') <= OUTPUT_LIMIT) {
    return { value: joined, truncated: false }
  }

  const tail = Buffer.from(joined, 'utf8').subarray(-OUTPUT_LIMIT).toString('utf8')
  return { value: tail, truncated: true }
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  const startedAt = Date.now()
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command

  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      const appended = appendLimited(stdout, chunk.toString('utf8'))
      stdout = appended.value
      stdoutTruncated ||= appended.truncated
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const appended = appendLimited(stderr, chunk.toString('utf8'))
      stderr = appended.value
      stderrTruncated ||= appended.truncated
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      resolve({
        command,
        args,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        stdout: redactSensitiveOutput(stdout),
        stderr: redactSensitiveOutput(error.message),
        stdoutTruncated,
        stderrTruncated,
        timedOut,
      })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({
        command,
        args,
        exitCode: timedOut ? 124 : (code ?? 1),
        durationMs: Date.now() - startedAt,
        stdout: redactSensitiveOutput(stdout),
        stderr: redactSensitiveOutput(stderr),
        stdoutTruncated,
        stderrTruncated,
        timedOut,
      })
    })
  })
}
