import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { isWithinRoot, toPosixPath } from './workspace.js'

const BLOCKED_SEGMENTS = new Set(['.git', 'node_modules', 'dist', 'coverage', 'dist-ssr'])
const BLOCKED_FILE_NAMES = new Set([
  'auth.json',
  'credentials.json',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
])
const BLOCKED_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.keystore', '.sqlite', '.db'])
const MAX_FILE_BYTES = 1024 * 1024
const MAX_OUTPUT_BYTES = 64 * 1024
const MAX_OUTPUT_LINES = 1000

export interface ReadFileRequest {
  path: string
  startLine?: number
  endLine?: number
}

export interface ReadFileResult {
  path: string
  startLine: number
  endLine: number
  totalLines: number
  truncated: boolean
  content: string
}

export function assertSafeRelativePath(requestedPath: string): string {
  if (!requestedPath || path.isAbsolute(requestedPath) || requestedPath.includes('\0')) {
    throw new Error('文件路径必须是非空的仓库相对路径')
  }

  const normalized = path.posix.normalize(requestedPath.replace(/\\/g, '/'))
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('文件路径不能离开仓库根目录')
  }

  const segments = normalized.split('/').map((segment) => segment.toLowerCase())
  const fileName = segments.at(-1)?.toLowerCase() ?? ''
  if (
    segments.some((segment) => BLOCKED_SEGMENTS.has(segment)) ||
    segments.some((segment) => segment === '.env' || segment.startsWith('.env.')) ||
    BLOCKED_FILE_NAMES.has(fileName) ||
    fileName.startsWith('secret') ||
    fileName.includes('credential') ||
    BLOCKED_EXTENSIONS.has(path.posix.extname(fileName))
  ) {
    throw new Error('该路径属于 MCP 禁止读取的敏感或低价值区域')
  }

  return normalized
}

export async function readAllowedFile(
  root: string,
  request: ReadFileRequest,
): Promise<ReadFileResult> {
  const relativePath = assertSafeRelativePath(request.path)
  const resolved = path.resolve(root, relativePath)
  if (!isWithinRoot(root, resolved)) {
    throw new Error('文件路径不能离开仓库根目录')
  }

  const metadata = await lstat(resolved)
  if (!metadata.isFile()) {
    throw new Error('只允许读取普通文件')
  }

  const canonical = await realpath(resolved)
  if (!isWithinRoot(root, canonical)) {
    throw new Error('符号链接目标不能离开仓库根目录')
  }

  const size = await stat(canonical)
  if (size.size > MAX_FILE_BYTES) {
    throw new Error('文件超过 MCP 单文件读取上限')
  }

  const bytes = await readFile(canonical)
  if (bytes.includes(0)) {
    throw new Error('不允许读取二进制文件')
  }

  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const lines = text.split(/\r?\n/)
  const startLine = Math.max(1, request.startLine ?? 1)
  const requestedEnd = Math.max(startLine, request.endLine ?? lines.length)
  const endLine = Math.min(lines.length, startLine + MAX_OUTPUT_LINES - 1, requestedEnd)
  let content = lines
    .slice(startLine - 1, endLine)
    .map((line, index) => String(startLine + index).padStart(5, ' ') + ' | ' + line)
    .join('\n')
  let truncated = endLine < requestedEnd || endLine < lines.length

  if (Buffer.byteLength(content, 'utf8') > MAX_OUTPUT_BYTES) {
    content = Buffer.from(content, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8')
    truncated = true
  }

  return {
    path: toPosixPath(root, canonical),
    startLine,
    endLine,
    totalLines: lines.length,
    truncated,
    content,
  }
}
